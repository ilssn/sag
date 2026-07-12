from __future__ import annotations

import copy
import hashlib
import os
import re
import stat
import tempfile
import zipfile
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from uuid6 import uuid7

from octx._documents import derived_title, render_document, split_frontmatter, validate_reserved_document
from octx._paths import is_concept_path, logical_path
from octx._strict import DuplicateKeyError, InvalidNumberError, loads_json, package_digest, pretty_json
from octx.errors import (
    ConfirmationRequired,
    DerivationRequired,
    OctxFormatError,
    OctxResourceLimitError,
    OctxSecurityError,
    OctxValidationError,
    OutputExistsError,
    ReleaseVersionError,
)
from octx.models import ArchiveLimits, CreateResult
from octx.package import open_octx
from octx.validation import validate_octx

_SEMVER = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\."
    r"(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)
_UUID7 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_PACKAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_STANDARD_PAYLOADS = {
    "data/chunks.jsonl",
    "data/events.jsonl",
    "data/entities.jsonl",
    "relations/chunk-events.jsonl",
    "relations/event-entities.jsonl",
    "vectors/config.json",
    "vectors/chunks.arrow",
    "vectors/events.arrow",
    "vectors/entities.arrow",
}
_STATE_PATH = Path(".octx") / "state.json"
_MANAGED_ROOTS = {".octx", "data", "extensions", "knowledge", "relations", "vectors"}


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _file_signature(metadata: os.stat_result) -> tuple[int, ...]:
    return metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns


def _safe_lstat(path: Path) -> os.stat_result:
    try:
        return path.lstat()
    except OSError as error:
        raise OctxSecurityError("directory entry changed while it was scanned", path=str(path)) from error


def _read_regular_file(path: Path, logical: str, limits: ArchiveLimits) -> bytes:
    descriptor = -1
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise OctxSecurityError("input is not a regular file", path=logical)
        if before.st_size > limits.max_file_size:
            raise OctxResourceLimitError("input exceeds configured file size limit", path=logical)
        chunks: list[bytes] = []
        total = 0
        while chunk := os.read(descriptor, min(1024 * 1024, limits.max_file_size + 1 - total)):
            total += len(chunk)
            if total > limits.max_file_size:
                raise OctxResourceLimitError("input exceeds configured file size limit", path=logical)
            chunks.append(chunk)
        if _file_signature(os.fstat(descriptor)) != _file_signature(before):
            raise OctxSecurityError("input changed while it was read", path=logical)
        return b"".join(chunks)
    except OctxSecurityError:
        raise
    except OSError as error:
        raise OctxSecurityError("input cannot be read safely", path=logical) from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _semver_key(value: str) -> tuple[Any, ...]:
    match = _SEMVER.fullmatch(value)
    if not match:
        raise ValueError(f"invalid SemVer: {value}")
    major, minor, patch = (int(match.group(index)) for index in (1, 2, 3))
    prerelease = match.group(4)
    if prerelease is None:
        pre_key: tuple[Any, ...] = (1,)
    else:
        identifiers: list[tuple[int, Any]] = []
        for identifier in prerelease.split("."):
            identifiers.append((0, int(identifier)) if identifier.isdigit() else (1, identifier))
        pre_key = (0, *identifiers)
    return major, minor, patch, pre_key


def _read_json_file(path: Path, limits: ArchiveLimits) -> dict[str, Any]:
    try:
        value = loads_json(
            _read_regular_file(path, str(path), limits),
            path=path.name,
            max_depth=limits.max_json_depth,
        )
    except DuplicateKeyError as error:
        raise OctxFormatError(str(error), path=str(path), code="OCTX_JSON_DUPLICATE_KEY") from error
    except (UnicodeError, InvalidNumberError, ValueError) as error:
        raise OctxFormatError(str(error), path=str(path)) from error
    if not isinstance(value, dict):
        raise OctxFormatError(f"{path} must contain a JSON object", path=str(path))
    return value


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _load_existing_manifest(workspace: Path, limits: ArchiveLimits) -> dict[str, Any] | None:
    path = workspace / "manifest.json"
    if path.is_symlink() or (path.exists() and not stat.S_ISREG(path.lstat().st_mode)):
        raise ValueError("workspace manifest.json must be a regular file")
    return _read_json_file(path, limits) if path.exists() else None


def _load_state(workspace: Path, manifest: dict[str, Any] | None, limits: ArchiveLimits) -> dict[str, Any]:
    path = workspace / _STATE_PATH
    if path.is_symlink() or (path.exists() and not stat.S_ISREG(path.lstat().st_mode)):
        raise ValueError("workspace .octx/state.json must be a regular file")
    if path.exists():
        state = _read_json_file(path, limits)
    else:
        state = {"asset": {}, "releases": {}}
    if not isinstance(state.get("asset"), dict):
        state["asset"] = {}
    if not isinstance(state.get("releases"), dict):
        state["releases"] = {}
    if manifest:
        asset = manifest.get("asset") if isinstance(manifest.get("asset"), dict) else {}
        release = manifest.get("release") if isinstance(manifest.get("release"), dict) else {}
        state["asset"].setdefault("id", asset.get("id"))
        state["asset"].setdefault("name", asset.get("name"))
        if isinstance(asset.get("derived_from"), dict):
            state["asset"].setdefault("derived_from", copy.deepcopy(asset["derived_from"]))
        version = release.get("version")
        if isinstance(version, str):
            state["releases"].setdefault(
                version,
                {
                    "status": "ready",
                    "created_at": release.get("created_at"),
                    "package_digest": release.get("package_digest"),
                },
            )
    return state


def _save_state(workspace: Path, state: dict[str, Any]) -> None:
    state_directory = workspace / _STATE_PATH.parent
    if state_directory.is_symlink() or (state_directory.exists() and not state_directory.is_dir()):
        raise ValueError("workspace .octx must be a real directory")
    _atomic_write(workspace / _STATE_PATH, pretty_json(state))


def _paths_overlap(first: Path, second: Path) -> bool:
    first = first.resolve()
    second = second.resolve()
    return first == second or first in second.parents or second in first.parents


def _validate_output_path(workspace: Path, output: Path) -> None:
    try:
        relative = output.resolve().relative_to(workspace.resolve())
    except ValueError:
        return
    if relative == Path(".") or relative == Path("manifest.json") or relative.parts[0] in _MANAGED_ROOTS:
        raise ValueError("output must not replace files managed by the OCTX working directory")


def _validate_workspace_tree(workspace: Path) -> None:
    for root, directories, files in os.walk(workspace, topdown=True, onerror=_raise_walk_error, followlinks=False):
        root_path = Path(root)
        for name in directories:
            candidate = root_path / name
            metadata = _safe_lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise OctxSecurityError("workspace contains a linked or special directory", path=str(candidate))
        for name in files:
            candidate = root_path / name
            metadata = _safe_lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise OctxSecurityError("workspace contains a linked or special file", path=str(candidate))


def _raise_walk_error(error: OSError) -> None:
    raise OctxSecurityError("directory tree cannot be scanned safely", path=error.filename) from error


def _walk_markdown(source: Path, limits: ArchiveLimits) -> list[Path]:
    if not source.is_dir() or source.is_symlink():
        raise ValueError(f"Markdown source must be a real directory: {source}")
    markdown: list[Path] = []
    for root, directories, files in os.walk(source, topdown=True, onerror=_raise_walk_error, followlinks=False):
        root_path = Path(root)
        for directory in list(directories):
            candidate = root_path / directory
            metadata = _safe_lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise ValueError(f"Markdown source contains a symlink: {candidate}")
        for filename in files:
            candidate = root_path / filename
            metadata = _safe_lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode):
                raise ValueError(f"Markdown source contains a symlink: {candidate}")
            if candidate.suffix == ".md":
                if not stat.S_ISREG(metadata.st_mode):
                    raise ValueError(f"Markdown source is not a regular file: {candidate}")
                markdown.append(candidate)
                if len(markdown) + 1 > limits.max_entries:
                    raise OctxResourceLimitError("Markdown source exceeds configured entry limit", path=str(source))
    if not markdown:
        raise ValueError(f"Markdown source contains no .md files: {source}")
    return sorted(markdown, key=lambda path: path.relative_to(source).as_posix().encode("utf-8"))


def _existing_document_metadata(
    workspace: Path,
    limits: ArchiveLimits,
    *,
    required_paths: set[str],
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    knowledge = workspace / "knowledge"
    if not knowledge.is_dir():
        return result
    for path in sorted(knowledge.rglob("*.md")):
        logical = "knowledge/" + path.relative_to(knowledge).as_posix()
        if not is_concept_path(logical) or path.is_symlink():
            continue
        raw = _read_regular_file(path, logical, limits)
        try:
            metadata, _ = split_frontmatter(raw, path=logical, max_depth=limits.max_yaml_depth)
        except Exception as error:
            raise OctxFormatError(
                "existing document frontmatter cannot be read safely",
                path=logical,
                code="OCTX_DOCUMENT_FRONTMATTER",
            ) from error
        namespace = metadata.get("octx")
        identifier = namespace.get("document_id") if isinstance(namespace, dict) else None
        if isinstance(identifier, str) and _UUID7.fullmatch(identifier):
            result[logical] = metadata
        elif logical in required_paths:
            raise OctxFormatError(
                "published document is missing its canonical octx.document_id",
                path=logical,
                code="OCTX_DOCUMENT_ID_INVALID",
            )
    missing = required_paths - result.keys()
    if missing:
        logical = min(missing, key=str.encode)
        raise OctxFormatError(
            "published document identity cannot be recovered before source overlay",
            path=logical,
            code="OCTX_DOCUMENT_ID_INVALID",
        )
    return result


def _validate_published_document_ids(
    workspace: Path,
    manifest: dict[str, Any],
    paths: set[str],
    state: dict[str, Any],
    limits: ArchiveLimits,
) -> None:
    baseline = state.get("documents")
    if not isinstance(baseline, dict):
        baseline = {}
        state["documents"] = baseline
    manifest_hashes = {
        entry.get("path"): entry.get("sha256")
        for entry in manifest.get("files", [])
        if isinstance(entry, dict)
    }
    for logical in sorted(paths, key=str.encode):
        candidate = workspace.joinpath(*logical.split("/"))
        if not candidate.exists():
            continue
        raw = _read_regular_file(candidate, logical, limits)
        try:
            metadata, _ = split_frontmatter(raw, path=logical, max_depth=limits.max_yaml_depth)
        except Exception as error:
            raise OctxFormatError(
                "published document frontmatter cannot be read safely",
                path=logical,
                code="OCTX_DOCUMENT_FRONTMATTER",
            ) from error
        namespace = metadata.get("octx")
        identifier = namespace.get("document_id") if isinstance(namespace, dict) else None
        if not isinstance(identifier, str) or _UUID7.fullmatch(identifier) is None:
            raise OctxFormatError(
                "published document is missing its canonical octx.document_id",
                path=logical,
                code="OCTX_DOCUMENT_ID_INVALID",
            )
        expected = baseline.get(logical)
        if not isinstance(expected, str) or _UUID7.fullmatch(expected) is None:
            expected = None
        if expected is not None and identifier != expected:
            raise OctxFormatError(
                "published document_id cannot change within an Asset",
                path=logical,
                code="OCTX_DOCUMENT_ID_CHANGED",
            )
        if expected is None:
            current_hash = hashlib.sha256(raw).hexdigest()
            if current_hash != manifest_hashes.get(logical):
                raise OctxFormatError(
                    "document identity baseline is unavailable after content changed",
                    path=logical,
                    code="OCTX_DOCUMENT_ID_BASELINE_MISSING",
                )
            baseline[logical] = identifier


def _copy_source(
    source: Path,
    workspace: Path,
    limits: ArchiveLimits,
    *,
    published_paths: set[str],
) -> None:
    markdown = _walk_markdown(source, limits)
    overlay_paths = {
        "knowledge/" + path.relative_to(source).as_posix()
        for path in markdown
        if is_concept_path("knowledge/" + path.relative_to(source).as_posix())
    }
    existing_metadata = _existing_document_metadata(
        workspace,
        limits,
        required_paths=published_paths & overlay_paths,
    )
    knowledge = workspace / "knowledge"
    total_size = 0
    for path in markdown:
        relative = path.relative_to(source)
        logical = "knowledge/" + relative.as_posix()
        data = _read_regular_file(path, str(path), limits)
        total_size += len(data)
        if total_size > limits.max_total_uncompressed:
            raise OctxResourceLimitError("Markdown source exceeds configured total size limit", path=str(source))
        if relative.name in {"index.md", "log.md"}:
            validate_reserved_document(data, path=logical, max_depth=limits.max_yaml_depth)
        destination = knowledge / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if is_concept_path(logical) and logical in existing_metadata:
            incoming, body = split_frontmatter(data, path=logical, max_depth=limits.max_yaml_depth, required=False)
            persisted = existing_metadata[logical]
            persisted_namespace = persisted.get("octx")
            persisted_id = persisted_namespace.get("document_id") if isinstance(persisted_namespace, dict) else None
            incoming_namespace = incoming.get("octx")
            incoming_id = incoming_namespace.get("document_id") if isinstance(incoming_namespace, dict) else None
            if incoming_id is not None and incoming_id != persisted_id:
                raise ValueError(f"{logical} attempts to replace its stable document_id")
            if incoming_id is None:
                metadata = copy.deepcopy(persisted)
                metadata.update(incoming)
                namespace = copy.deepcopy(persisted_namespace) if isinstance(persisted_namespace, dict) else {}
                if isinstance(incoming_namespace, dict):
                    namespace.update(incoming_namespace)
                namespace["document_id"] = persisted_id
                metadata["octx"] = namespace
                data = render_document(metadata, body)
        _atomic_write(destination, data)


def _in_place_changes(workspace: Path, limits: ArchiveLimits) -> tuple[list[tuple[Path, Path]], list[str]]:
    moves: list[tuple[Path, Path]] = []
    changes: list[str] = []
    knowledge = workspace / "knowledge"
    for path in _walk_markdown(workspace, limits):
        if path == knowledge or knowledge in path.parents or _STATE_PATH.parts[0] in path.relative_to(workspace).parts:
            continue
        relative = path.relative_to(workspace)
        destination = knowledge / relative
        if destination.exists():
            raise FileExistsError(f"in-place destination already exists: {destination}")
        moves.append((path, destination))
        changes.append(f"move {relative.as_posix()} -> knowledge/{relative.as_posix()}")
    candidates = [destination for _, destination in moves]
    if knowledge.is_dir():
        candidates.extend(knowledge.rglob("*.md"))
    for path in candidates:
        logical = "knowledge/" + path.relative_to(knowledge).as_posix()
        data = (
            _read_regular_file(path, logical, limits)
            if path.exists()
            else next(_read_regular_file(source, str(source), limits) for source, target in moves if target == path)
        )
        if is_concept_path(logical):
            metadata, _ = split_frontmatter(data, path=logical, max_depth=limits.max_yaml_depth, required=False)
            namespace = metadata.get("octx")
            if (
                "type" not in metadata
                or "title" not in metadata
                or not isinstance(namespace, dict)
                or "document_id" not in namespace
            ):
                changes.append(f"complete frontmatter for {logical}")
        else:
            validate_reserved_document(data, path=logical, max_depth=limits.max_yaml_depth)
    changes.extend(["write or update manifest.json", "write or update .octx/state.json"])
    return moves, changes


def _perform_in_place(workspace: Path, moves: list[tuple[Path, Path]]) -> None:
    for source, destination in moves:
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, destination)


def _prepare_documents(
    workspace: Path,
    limits: ArchiveLimits,
    *,
    repair_invalid_ids: bool = False,
) -> dict[str, str]:
    knowledge = workspace / "knowledge"
    if not knowledge.is_dir():
        raise ValueError("workspace must contain a knowledge/ directory")
    identifiers: dict[str, str] = {}
    for path in sorted(knowledge.rglob("*.md")):
        logical = logical_path("knowledge/" + path.relative_to(knowledge).as_posix())
        if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError(f"knowledge entry must be a regular file: {logical}")
        raw = _read_regular_file(path, logical, limits)
        if not is_concept_path(logical):
            validate_reserved_document(raw, path=logical, max_depth=limits.max_yaml_depth)
            continue
        metadata, body = split_frontmatter(raw, path=logical, max_depth=limits.max_yaml_depth, required=False)
        changed = False
        if "type" not in metadata:
            metadata["type"] = "Document"
            changed = True
        if "title" not in metadata:
            metadata["title"] = derived_title(logical, body)
            changed = True
        namespace = metadata.get("octx")
        if namespace is None or (repair_invalid_ids and not isinstance(namespace, dict)):
            namespace = {}
            metadata["octx"] = namespace
            changed = True
        identifier = namespace.get("document_id") if isinstance(namespace, dict) else None
        if isinstance(namespace, dict) and (
            "document_id" not in namespace or (repair_invalid_ids and not _UUID7.fullmatch(str(identifier)))
        ):
            namespace["document_id"] = str(uuid7())
            changed = True
        if changed:
            _atomic_write(path, render_document(metadata, body))
        identifier = namespace.get("document_id") if isinstance(namespace, dict) else None
        if isinstance(identifier, str):
            identifiers[logical] = identifier
    if not identifiers:
        raise ValueError("workspace must contain at least one Concept Document")
    return identifiers


def _read_document_ids(workspace: Path, limits: ArchiveLimits) -> dict[str, str]:
    identifiers: dict[str, str] = {}
    with open_octx(workspace, limits=limits) as package:
        for document in package.iter_documents():
            namespace = document.metadata.get("octx")
            identifier = namespace.get("document_id") if isinstance(namespace, dict) else None
            if isinstance(identifier, str):
                identifiers[document.path] = identifier
    return identifiers


def _declarations(value: Mapping[str, str | Mapping[str, Any]] | None, existing: Any) -> dict[str, Any] | None:
    if value is None:
        return copy.deepcopy(existing) if isinstance(existing, dict) and existing else None
    if not value:
        return None
    result: dict[str, Any] = {}
    for name, declaration in value.items():
        if isinstance(declaration, str):
            result[name] = {"version": declaration}
        elif isinstance(declaration, Mapping):
            result[name] = copy.deepcopy(dict(declaration))
        else:
            raise TypeError(f"declaration for {name} must be a version string or mapping")
    return result


def _inherited_declarations(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """Carry only the declaration contract this writer understands into a new snapshot."""
    if not value:
        return None
    result: dict[str, Any] = {}
    for name, declaration in value.items():
        if isinstance(declaration, dict) and isinstance(declaration.get("version"), str):
            result[name] = {"version": declaration["version"]}
        else:
            result[name] = copy.deepcopy(declaration)
    return result


def _payload_files(workspace: Path, limits: ArchiveLimits) -> list[tuple[str, Path]]:
    payloads: list[tuple[str, Path]] = []
    total_size = 0
    for root, directories, files in os.walk(workspace, topdown=True, onerror=_raise_walk_error, followlinks=False):
        root_path = Path(root)
        relative_root = root_path.relative_to(workspace)
        directories[:] = [
            directory for directory in directories if not (relative_root == Path(".") and directory == ".octx")
        ]
        for directory in directories:
            candidate = root_path / directory
            metadata = _safe_lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise ValueError(f"workspace contains a symlink: {candidate}")
        for filename in files:
            candidate = root_path / filename
            logical = candidate.relative_to(workspace).as_posix()
            if logical == "manifest.json" or logical.startswith(".octx/"):
                continue
            include = (
                (logical.startswith("knowledge/") and logical.endswith(".md"))
                or logical in _STANDARD_PAYLOADS
                or logical.startswith("extensions/")
            )
            if not include:
                continue
            logical_path(logical)
            metadata = _safe_lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise ValueError(f"payload must be a regular file: {logical}")
            size = metadata.st_size
            if size > limits.max_file_size:
                raise OctxResourceLimitError("payload exceeds configured file size limit", path=logical)
            total_size += size
            if total_size > limits.max_total_uncompressed:
                raise OctxResourceLimitError("workspace exceeds configured total size limit", path=str(workspace))
            payloads.append((logical, candidate))
            if len(payloads) + 1 > limits.max_entries:
                raise OctxResourceLimitError("workspace exceeds configured entry limit", path=str(workspace))
    return sorted(payloads, key=lambda item: item[0].encode("utf-8"))


def _hash_payload(path: Path, logical: str, limits: ArchiveLimits) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise OctxSecurityError("payload cannot be opened safely", path=logical) from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise OctxSecurityError("payload is no longer a regular file", path=logical)
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = -1
            while chunk := stream.read(1024 * 1024):
                total += len(chunk)
                if total > limits.max_file_size:
                    raise OctxResourceLimitError("payload exceeds configured file size limit", path=logical)
                digest.update(chunk)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    return digest.hexdigest(), total


def _manifest(
    existing: dict[str, Any] | None,
    *,
    asset_id: str,
    name: str,
    version: str,
    created_at: str,
    capabilities: dict[str, Any] | None,
    derived_from: dict[str, str] | None,
    payloads: list[tuple[str, Path]],
    limits: ArchiveLimits,
    preserve_unknown: bool = False,
) -> dict[str, Any]:
    manifest = copy.deepcopy(existing) if existing and preserve_unknown else {}
    if preserve_unknown:
        manifest.setdefault("format", "octx")
        manifest.setdefault("format_version", "0.1")
    else:
        manifest["format"] = "octx"
        manifest["format_version"] = "0.1"
    asset = manifest.setdefault("asset", {})
    if not isinstance(asset, dict):
        raise ValueError("manifest.asset must be an object")
    previous_asset_id = asset.get("id")
    allowed_previous_ids = {None, asset_id}
    if derived_from is not None:
        allowed_previous_ids.add(derived_from["asset_id"])
    if previous_asset_id not in allowed_previous_ids:
        raise ValueError("workspace manifest asset.id conflicts with persisted asset identity")
    asset["id"] = asset_id
    asset["name"] = name
    if derived_from is not None:
        asset["derived_from"] = copy.deepcopy(derived_from)
    release = manifest.setdefault("release", {})
    if not isinstance(release, dict):
        raise ValueError("manifest.release must be an object")
    release["version"] = version
    release["created_at"] = created_at
    if capabilities:
        manifest["capabilities"] = capabilities
    else:
        manifest.pop("capabilities", None)
    existing_files = (
        {
            entry.get("path"): entry
            for entry in manifest.get("files", [])
            if isinstance(entry, dict) and isinstance(entry.get("path"), str)
        }
        if preserve_unknown
        else {}
    )
    files: list[dict[str, Any]] = []
    total_size = 0
    for logical, path in payloads:
        entry = copy.deepcopy(existing_files.get(logical, {}))
        entry["path"] = logical
        entry["sha256"], size = _hash_payload(path, logical, limits)
        total_size += size
        if total_size > limits.max_total_uncompressed:
            raise OctxResourceLimitError("workspace exceeds configured total size limit")
        files.append(entry)
    manifest["files"] = files
    release["package_digest"] = package_digest(manifest)
    manifest_size = len(pretty_json(manifest))
    if manifest_size > limits.max_file_size or total_size + manifest_size > limits.max_total_uncompressed:
        raise OctxResourceLimitError("manifest and payloads exceed configured size limits", path="manifest.json")
    return manifest


def _write_archive(
    path: Path,
    manifest: dict[str, Any],
    payloads: list[tuple[str, Path]],
    limits: ArchiveLimits,
) -> None:
    manifest_bytes = pretty_json(manifest)
    total_size = len(manifest_bytes)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        info = zipfile.ZipInfo("manifest.json", date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = (stat.S_IFREG | 0o644) << 16
        info.compress_type = zipfile.ZIP_STORED
        archive.writestr(info, manifest_bytes)
        for logical, source in payloads:
            info = zipfile.ZipInfo(logical, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_STORED
            file_size = 0
            try:
                descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            except OSError as error:
                raise OctxSecurityError("payload cannot be opened safely", path=logical) from error
            try:
                metadata = os.fstat(descriptor)
                if not stat.S_ISREG(metadata.st_mode):
                    raise OctxSecurityError("payload is no longer a regular file", path=logical)
                with os.fdopen(descriptor, "rb") as incoming, archive.open(info, "w", force_zip64=True) as outgoing:
                    descriptor = -1
                    while chunk := incoming.read(1024 * 1024):
                        file_size += len(chunk)
                        total_size += len(chunk)
                        if file_size > limits.max_file_size or total_size > limits.max_total_uncompressed:
                            raise OctxResourceLimitError(
                                "payload changed beyond configured size limits", path=logical
                            )
                        outgoing.write(chunk)
            finally:
                if descriptor >= 0:
                    os.close(descriptor)


def _check_output(output: Path, manifest: dict[str, Any], limits: ArchiveLimits) -> bool:
    if not output.exists() and not output.is_symlink():
        return False
    try:
        with open_octx(output, limits=limits) as package:
            report = validate_octx(package)
            if not report.valid:
                raise ValueError("existing output is invalid")
            existing = package.manifest
        existing_asset = existing.get("asset") if isinstance(existing.get("asset"), dict) else {}
        existing_release = existing.get("release") if isinstance(existing.get("release"), dict) else {}
    except Exception as error:
        raise OutputExistsError(f"output already exists and is not the same valid Package: {output}") from error
    identity = (
        existing_asset.get("id"),
        existing_release.get("version"),
        existing_release.get("package_digest"),
    )
    expected = (
        manifest["asset"]["id"],
        manifest["release"]["version"],
        manifest["release"]["package_digest"],
    )
    if identity != expected:
        raise OutputExistsError(f"output already contains a different immutable Package: {output}")
    return True


def _publish_archive(temporary: Path, output: Path, manifest: dict[str, Any], limits: ArchiveLimits) -> None:
    if _check_output(output, manifest, limits):
        return
    try:
        os.link(temporary, output)
    except FileExistsError as error:
        if _check_output(output, manifest, limits):
            return
        raise OutputExistsError(f"output changed while the Package was being published: {output}") from error
    except OSError as error:
        raise OutputExistsError(f"Package could not be published without overwriting output: {output}") from error


def _source_reference(manifest: dict[str, Any]) -> dict[str, str]:
    asset = manifest.get("asset") if isinstance(manifest.get("asset"), dict) else {}
    release = manifest.get("release") if isinstance(manifest.get("release"), dict) else {}
    asset_id = asset.get("id")
    version = release.get("version")
    digest = release.get("package_digest")
    format_version = manifest.get("format_version")
    if (
        manifest.get("format") != "octx"
        or format_version != "0.1"
        or not isinstance(asset_id, str)
        or _UUID7.fullmatch(asset_id) is None
        or not isinstance(version, str)
        or not isinstance(digest, str)
        or _PACKAGE_DIGEST.fullmatch(digest) is None
    ):
        raise OctxFormatError("source manifest cannot identify a supported OCTX Package", path="manifest.json")
    try:
        _semver_key(version)
        computed = package_digest(manifest)
    except (KeyError, TypeError, ValueError) as error:
        raise OctxFormatError("source manifest package identity is invalid", path="manifest.json") from error
    if computed != digest:
        raise OctxFormatError("source manifest package_digest is invalid", path="manifest.json")
    return {"asset_id": asset_id, "version": version, "package_digest": digest}


def _external_repack(
    workspace: Path,
    output: Path,
    manifest: dict[str, Any],
    *,
    name: str | None,
    version: str | None,
    capabilities: Mapping[str, str | Mapping[str, Any]] | None,
    limits: ArchiveLimits,
) -> CreateResult:
    asset = manifest.get("asset") if isinstance(manifest.get("asset"), dict) else {}
    release = manifest.get("release") if isinstance(manifest.get("release"), dict) else {}
    asset_id = asset.get("id")
    asset_name = asset.get("name")
    release_version = release.get("version")
    created_at = release.get("created_at")
    declared_capabilities = _declarations(capabilities, manifest.get("capabilities"))
    if not all(isinstance(value, str) for value in (asset_id, asset_name, release_version, created_at)):
        raise OctxFormatError("external Package manifest has an invalid identity", path="manifest.json")
    if name is not None and name != asset_name:
        raise DerivationRequired("changing an external Package name requires a Derived Asset")
    if version is not None and version != release_version:
        raise DerivationRequired("publishing a new version of an external Package requires a Derived Asset")

    with open_octx(workspace, limits=limits) as package:
        if package.manifest != manifest:
            raise OctxSecurityError("workspace manifest changed while it was inspected", path="manifest.json")
        payloads = [(logical, workspace / logical) for logical in package.files]
        candidate = _manifest(
            manifest,
            asset_id=asset_id,
            name=asset_name,
            version=release_version,
            created_at=created_at,
            capabilities=declared_capabilities,
            derived_from=None,
            payloads=payloads,
            limits=limits,
            preserve_unknown=True,
        )
        original_digest = release.get("package_digest")
        if candidate["release"]["package_digest"] != original_digest:
            raise DerivationRequired("external Package content changed; publish it as a Derived Asset")
        report = validate_octx(package)
        if not report.valid:
            raise OctxValidationError("cannot re-container an invalid external Package", report)

    _check_output(output, candidate, limits)
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        _write_archive(temporary, candidate, payloads, limits)
        archive_report = validate_octx(temporary, limits=limits)
        if not archive_report.valid:
            raise OctxValidationError("repacked Package did not pass validation", archive_report)
        _publish_archive(temporary, output, candidate, limits)
    finally:
        temporary.unlink(missing_ok=True)
    return CreateResult(
        output=output,
        workspace=workspace,
        asset_id=asset_id,
        version=release_version,
        created_at=created_at,
        package_digest=original_digest,
        document_ids=_read_document_ids(workspace, limits),
        report=archive_report,
    )


def create_octx(
    workspace: os.PathLike[str] | str,
    *,
    output: os.PathLike[str] | str,
    source: os.PathLike[str] | str | None = None,
    name: str | None = None,
    version: str | None = None,
    in_place: bool = False,
    confirm_in_place: bool = False,
    derive: bool = False,
    capabilities: Mapping[str, str | Mapping[str, Any]] | None = None,
    limits: ArchiveLimits | None = None,
) -> CreateResult:
    if source is not None and in_place:
        raise ValueError("source and in_place are mutually exclusive")
    selected_limits = limits or ArchiveLimits()
    workspace_path = Path(workspace).expanduser().absolute()
    output_path = Path(output).expanduser().absolute()
    source_path = Path(source).expanduser().absolute() if source is not None else None
    if source_path is not None and _paths_overlap(source_path, workspace_path):
        raise ValueError("source and workspace directories must not overlap")
    workspace_path.mkdir(parents=True, exist_ok=True)
    if workspace_path.is_symlink() or not workspace_path.is_dir():
        raise ValueError("workspace must be a real directory")
    _validate_workspace_tree(workspace_path)
    _validate_output_path(workspace_path, output_path)

    existing = _load_existing_manifest(workspace_path, selected_limits)
    _payload_files(workspace_path, selected_limits)
    state_exists = (workspace_path / _STATE_PATH).exists()
    if existing is not None and not state_exists and not derive:
        if source_path is not None or in_place:
            raise DerivationRequired("modifying an external Package requires explicit derive=True")
        return _external_repack(
            workspace_path,
            output_path,
            existing,
            name=name,
            version=version,
            capabilities=capabilities,
            limits=selected_limits,
        )
    if derive and (existing is None or state_exists):
        raise ValueError("derive=True requires an expanded external Package without local producer state")

    if derive:
        derived_from = _source_reference(existing)
        source_asset = existing.get("asset") if isinstance(existing.get("asset"), dict) else {}
        inherited_name = source_asset.get("name")
        state = {
            "asset": {
                "id": str(uuid7()),
                "name": name if name is not None else inherited_name,
                "derived_from": derived_from,
            },
            "releases": {},
        }
        derivation_pending = True
    else:
        state = _load_state(workspace_path, existing, selected_limits)
        state_asset_value = state.get("asset")
        state_asset_candidate = state_asset_value if isinstance(state_asset_value, dict) else {}
        source_candidate = state_asset_candidate.get("derived_from")
        existing_asset = existing.get("asset") if existing and isinstance(existing.get("asset"), dict) else {}
        derivation_pending = (
            isinstance(source_candidate, dict)
            and state_asset_candidate.get("id") != existing_asset.get("id")
            and source_candidate.get("asset_id") == existing_asset.get("id")
        )
        derived_from = copy.deepcopy(source_candidate) if isinstance(source_candidate, dict) else None

    state_asset = state["asset"]
    asset_id = state_asset.get("id") or str(uuid7())
    asset_name = name if name is not None else state_asset.get("name")
    if not isinstance(asset_id, str) or _UUID7.fullmatch(asset_id) is None:
        raise ValueError("local producer state contains an invalid asset id")
    if not isinstance(asset_name, str) or not asset_name:
        raise ValueError("name is required when creating a new OCTX Asset")
    state_asset.update({"id": asset_id, "name": asset_name})
    if derived_from is not None:
        state_asset["derived_from"] = copy.deepcopy(derived_from)

    existing_release = existing.get("release") if existing and isinstance(existing.get("release"), dict) else {}
    state_versions = list(state["releases"])
    for state_version in state_versions:
        _semver_key(state_version)
    state_default_version = max(state_versions, key=_semver_key) if state_versions else None
    existing_default_version = None if derivation_pending else existing_release.get("version")
    selected_version = version or existing_default_version or state_default_version or "1.0.0"
    _semver_key(selected_version)
    ready_versions = [
        release_version
        for release_version, release_state in state["releases"].items()
        if isinstance(release_state, dict) and release_state.get("status") == "ready"
    ]
    if selected_version not in ready_versions and ready_versions:
        highest = max(ready_versions, key=_semver_key)
        if _semver_key(selected_version) <= _semver_key(highest):
            raise ReleaseVersionError(f"new Release version must be higher than {highest}")
    declared_capabilities = _declarations(capabilities, existing.get("capabilities") if existing else None)
    if existing and not derivation_pending:
        existing_asset = existing.get("asset") if isinstance(existing.get("asset"), dict) else {}
        if existing_asset.get("id") not in {None, asset_id}:
            raise ValueError("workspace manifest conflicts with local producer state")

    published_paths = {
        entry["path"]
        for entry in (existing.get("files", []) if existing and not derivation_pending else [])
        if isinstance(entry, dict) and isinstance(entry.get("path"), str) and is_concept_path(entry["path"])
    }
    if existing is not None and not derivation_pending:
        _validate_published_document_ids(
            workspace_path,
            existing,
            published_paths,
            state,
            selected_limits,
        )

    preserve_unknown = bool(
        existing is not None
        and not derivation_pending
        and existing_release.get("version") == selected_version
    )
    if not preserve_unknown:
        if capabilities is None:
            declared_capabilities = _inherited_declarations(declared_capabilities)
    moves: list[tuple[Path, Path]] = []
    if in_place:
        moves, changes = _in_place_changes(workspace_path, selected_limits)
        if not confirm_in_place:
            raise ConfirmationRequired("in-place creation requires explicit confirmation", changes)

    release_state = state["releases"].setdefault(selected_version, {})
    previous_release_state = copy.deepcopy(release_state)
    created_at = (
        release_state.get("created_at")
        or (existing_release.get("created_at") if existing_release.get("version") == selected_version else None)
        or _now()
    )
    release_state.update({"status": "building", "created_at": created_at})
    _save_state(workspace_path, state)

    try:
        if in_place:
            _perform_in_place(workspace_path, moves)
        elif source_path is not None:
            _copy_source(
                source_path,
                workspace_path,
                selected_limits,
                published_paths=published_paths,
            )
        document_ids = _prepare_documents(
            workspace_path,
            selected_limits,
            repair_invalid_ids=derivation_pending,
        )
        payloads = _payload_files(workspace_path, selected_limits)
        manifest = _manifest(
            existing,
            asset_id=asset_id,
            name=asset_name,
            version=selected_version,
            created_at=created_at,
            capabilities=declared_capabilities,
            derived_from=derived_from,
            payloads=payloads,
            limits=selected_limits,
            preserve_unknown=preserve_unknown,
        )
        state_ready_digest = (
            previous_release_state.get("package_digest") if previous_release_state.get("status") == "ready" else None
        )
        manifest_ready_digest = (
            existing_release.get("package_digest")
            if existing_release.get("version") == selected_version and not derivation_pending
            else None
        )
        if state_ready_digest and manifest_ready_digest and state_ready_digest != manifest_ready_digest:
            raise ReleaseVersionError("local producer state conflicts with the published workspace manifest")
        ready_digest = state_ready_digest or manifest_ready_digest
        if ready_digest and ready_digest != manifest["release"]["package_digest"]:
            raise ReleaseVersionError("content changed; publish it with a higher SemVer")
        _check_output(output_path, manifest, selected_limits)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{output_path.name}.", suffix=".tmp", dir=output_path.parent
        )
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            _write_archive(temporary, manifest, payloads, selected_limits)
            report = validate_octx(temporary, limits=selected_limits)
            lossless_ready_rebuild = ready_digest == manifest["release"]["package_digest"]
            if not report.valid or (not report.fully_validated and not lossless_ready_rebuild):
                raise OctxValidationError("created Package did not pass complete validation", report)
            _atomic_write(workspace_path / "manifest.json", pretty_json(manifest))
            _publish_archive(temporary, output_path, manifest, selected_limits)
        finally:
            temporary.unlink(missing_ok=True)
    except Exception:
        if previous_release_state.get("status") == "ready":
            state["releases"][selected_version] = previous_release_state
        else:
            release_state["status"] = "failed"
        _save_state(workspace_path, state)
        raise

    release_state.update(
        {
            "status": "ready",
            "created_at": created_at,
            "package_digest": manifest["release"]["package_digest"],
        }
    )
    state["documents"] = dict(document_ids)
    _save_state(workspace_path, state)
    return CreateResult(
        output=output_path,
        workspace=workspace_path,
        asset_id=asset_id,
        version=selected_version,
        created_at=created_at,
        package_digest=manifest["release"]["package_digest"],
        document_ids=document_ids,
        report=report,
    )
