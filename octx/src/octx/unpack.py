from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import stat
import sys
import tempfile
import unicodedata
from pathlib import Path

from octx._strict import pretty_json
from octx.errors import OctxIntegrityError, OctxValidationError
from octx.models import ArchiveLimits
from octx.package import OctxPackage, open_octx
from octx.validation import validate_octx

_WINDOWS_RESERVED = {
    "aux",
    "con",
    "nul",
    "prn",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}
_WINDOWS_FORBIDDEN = frozenset('<>:"\\|?*')


def _portable_segment(segment: str, path: str) -> str:
    if (
        any(ord(character) < 32 or character in _WINDOWS_FORBIDDEN for character in segment)
        or segment.endswith((" ", "."))
        or segment.split(".", 1)[0].casefold() in _WINDOWS_RESERVED
    ):
        raise FileExistsError(f"payload path is not portable to the target filesystem: {path}")
    return unicodedata.normalize("NFC", segment).casefold()


def _check_target_collisions(paths: tuple[str, ...]) -> None:
    seen: dict[tuple[str, ...], str] = {}
    for path in paths:
        parts = path.split("/")
        portable = tuple(_portable_segment(part, path) for part in parts)
        existing = seen.get(portable)
        if existing is not None and existing != path:
            raise FileExistsError(f"payload paths collide on the target filesystem: {existing} and {path}")
        seen[portable] = path
    for portable, path in seen.items():
        for index in range(1, len(portable)):
            parent = seen.get(portable[:index])
            if parent is not None:
                raise FileExistsError(f"payload path conflicts with file parent {parent}: {path}")


def _reject_symlink_ancestors(path: Path) -> None:
    current = path
    while True:
        if current.is_symlink():
            raise FileExistsError(f"unpack path must not contain symbolic links: {current}")
        if current.exists() and current != path and not current.is_dir():
            raise FileExistsError(f"unpack parent must be a directory: {current}")
        if current.parent == current:
            return
        current = current.parent


def _normalize_platform_alias(path: Path) -> Path:
    if sys.platform != "darwin" or len(path.parts) < 2:
        return path
    aliases = {"var": "/private/var", "tmp": "/private/tmp", "etc": "/private/etc"}
    replacement = aliases.get(path.parts[1])
    return Path(replacement, *path.parts[2:]) if replacement is not None else path


def _supports_safe_dirfd() -> bool:
    return (
        os.open in os.supports_dir_fd
        and os.mkdir in os.supports_dir_fd
        and os.rename in os.supports_dir_fd
        and bool(getattr(os, "O_NOFOLLOW", 0))
        and bool(getattr(os, "O_DIRECTORY", 0))
    )


def _open_or_create_directory(path: Path) -> int:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    current = os.open(path.anchor, flags)
    try:
        for part in path.parts[1:]:
            try:
                following = os.open(part, flags, dir_fd=current)
            except FileNotFoundError:
                os.mkdir(part, 0o755, dir_fd=current)
                following = os.open(part, flags, dir_fd=current)
            except OSError as error:
                raise FileExistsError(f"unpack parent is not a safe directory: {path}") from error
            os.close(current)
            current = following
        return current
    except Exception:
        os.close(current)
        raise


def _open_relative_directory(root: int, parts: list[str]) -> int:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    current = os.dup(root)
    try:
        for part in parts:
            try:
                os.mkdir(part, 0o755, dir_fd=current)
            except FileExistsError:
                pass
            following = os.open(part, flags, dir_fd=current)
            os.close(current)
            current = following
        return current
    except Exception:
        os.close(current)
        raise


def _remove_tree_at(parent: int, name: str) -> None:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        directory = os.open(name, flags, dir_fd=parent)
    except FileNotFoundError:
        return
    try:
        for child in os.listdir(directory):
            metadata = os.stat(child, dir_fd=directory, follow_symlinks=False)
            if stat.S_ISDIR(metadata.st_mode):
                _remove_tree_at(directory, child)
            else:
                os.unlink(child, dir_fd=directory)
    finally:
        os.close(directory)
    os.rmdir(name, dir_fd=parent)


def _unpack_with_dirfd(
    package: OctxPackage,
    target: Path,
    paths: tuple[str, ...],
    expected_hashes: dict[str, str],
) -> Path:
    parent = _open_or_create_directory(target.parent)
    staging_name = f".{target.name}.{secrets.token_hex(12)}.tmp"
    published = False
    try:
        try:
            target_metadata = os.stat(target.name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            target_metadata = None
        if target_metadata is not None:
            if not stat.S_ISDIR(target_metadata.st_mode):
                raise FileExistsError(f"unpack destination must be a real directory: {target}")
            target_fd = os.open(target.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                if os.listdir(target_fd):
                    raise FileExistsError(f"unpack destination must be empty: {target}")
            finally:
                os.close(target_fd)

        os.mkdir(staging_name, 0o755, dir_fd=parent)
        staging = os.open(staging_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            for path in paths:
                parts = path.split("/")
                output_parent = _open_relative_directory(staging, parts[:-1])
                try:
                    descriptor = os.open(
                        parts[-1],
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o644,
                        dir_fd=output_parent,
                    )
                    with os.fdopen(descriptor, "wb") as outgoing:
                        if path == "manifest.json":
                            outgoing.write(pretty_json(package.manifest))
                            continue
                        digest = hashlib.sha256()
                        with package.open_payload(path) as incoming:
                            while chunk := incoming.read(1024 * 1024):
                                digest.update(chunk)
                                outgoing.write(chunk)
                        if digest.hexdigest() != expected_hashes[path]:
                            raise OctxIntegrityError("payload changed after validation", path=path)
                finally:
                    os.close(output_parent)
        finally:
            os.close(staging)
        if target_metadata is not None:
            os.rmdir(target.name, dir_fd=parent)
        os.rename(staging_name, target.name, src_dir_fd=parent, dst_dir_fd=parent)
        published = True
        return target
    finally:
        if not published:
            _remove_tree_at(parent, staging_name)
        os.close(parent)


def unpack_octx(
    package_or_source: OctxPackage | os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
) -> Path:
    if not isinstance(package_or_source, OctxPackage):
        with open_octx(package_or_source, limits=limits) as package:
            return unpack_octx(package, destination)
    if limits is not None and limits != package_or_source.limits:
        with open_octx(package_or_source.source, limits=limits) as package:
            return unpack_octx(package, destination)
    package = package_or_source
    report = validate_octx(package, limits=limits)
    if not report.valid:
        raise OctxValidationError("cannot unpack an invalid OCTX Package", report)

    target = _normalize_platform_alias(Path(destination).expanduser().absolute())
    if target.parent == target or not target.name:
        raise FileExistsError("unpack destination must not be a filesystem root")
    _reject_symlink_ancestors(target)
    paths = ("manifest.json", *package.files)
    _check_target_collisions(paths)
    expected_hashes = {
        entry["path"]: entry["sha256"]
        for entry in package.manifest["files"]
        if isinstance(entry, dict) and isinstance(entry.get("path"), str)
    }
    if _supports_safe_dirfd():
        return _unpack_with_dirfd(package, target, paths, expected_hashes)

    if target.exists():
        if not target.is_dir() or any(target.iterdir()):
            raise FileExistsError(f"unpack destination must not exist or must be empty: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    _reject_symlink_ancestors(target.parent)
    staging = Path(tempfile.mkdtemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent))
    try:
        for path in paths:
            output = staging.joinpath(*path.split("/"))
            output.parent.mkdir(parents=True, exist_ok=True)
            if path == "manifest.json":
                output.write_bytes(pretty_json(package.manifest))
                continue
            digest = hashlib.sha256()
            with package.open_payload(path) as incoming, output.open("xb") as outgoing:
                while chunk := incoming.read(1024 * 1024):
                    digest.update(chunk)
                    outgoing.write(chunk)
            if digest.hexdigest() != expected_hashes[path]:
                raise OctxIntegrityError("payload changed after validation", path=path)
        if target.exists():
            target.rmdir()
        os.replace(staging, target)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return target
