from __future__ import annotations

import stat
import warnings
import zipfile
from pathlib import Path

import pytest
from conftest import repack

from octx import ArchiveLimits, create_octx, open_octx, unpack_octx, validate_octx
from octx.errors import OctxFormatError, OctxResourceLimitError, OctxSecurityError, OctxValidationError


def _rewrite_zip(source: Path, target: Path, *, replace: dict[str, bytes] | None = None, extras=()) -> None:
    replace = replace or {}
    with (
        zipfile.ZipFile(source) as incoming,
        zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as outgoing,
    ):
        for info in incoming.infolist():
            outgoing.writestr(info, replace.get(info.filename, incoming.read(info)))
        for info, content in extras:
            outgoing.writestr(info, content)


def _valid_package(markdown_source: Path, tmp_path: Path) -> Path:
    return create_octx(
        tmp_path / "workspace",
        source=markdown_source,
        name="Guide",
        output=tmp_path / "valid.octx",
    ).output


def _central_header_offset(data: bytes | bytearray, filename: bytes) -> int:
    cursor = 0
    while (cursor := data.find(b"PK\x01\x02", cursor)) >= 0:
        filename_size = int.from_bytes(data[cursor + 28 : cursor + 30], "little")
        if data[cursor + 46 : cursor + 46 + filename_size] == filename:
            return cursor
        cursor += 4
    raise AssertionError(f"missing central header for {filename!r}")


@pytest.mark.parametrize("name", ["../escape", "/absolute", "./dot", "a//b", "a\\b", "a/../b"])
def test_open_rejects_dangerous_paths(markdown_source: Path, tmp_path: Path, name: str) -> None:
    package = _valid_package(markdown_source, tmp_path)
    dangerous = zipfile.ZipInfo(name)
    dangerous.external_attr = (stat.S_IFREG | 0o644) << 16
    mutated = tmp_path / "dangerous.octx"
    _rewrite_zip(package, mutated, extras=[(dangerous, b"x")])

    with pytest.raises(OctxSecurityError):
        open_octx(mutated)


def test_open_rejects_symlinks_even_when_unlisted(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    symlink = zipfile.ZipInfo("safe-looking")
    symlink.create_system = 3
    symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
    mutated = tmp_path / "symlink.octx"
    _rewrite_zip(package, mutated, extras=[(symlink, b"../target")])

    with pytest.raises(OctxSecurityError):
        open_octx(mutated)


def test_open_rejects_duplicate_archive_paths(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    duplicate = zipfile.ZipInfo("knowledge/guide.md")
    duplicate.external_attr = (stat.S_IFREG | 0o644) << 16
    mutated = tmp_path / "duplicate.octx"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        _rewrite_zip(package, mutated, extras=[(duplicate, b"duplicate")])

    with pytest.raises(OctxSecurityError):
        open_octx(mutated)


def test_unlisted_regular_files_are_invisible_and_not_unpacked(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    extra = zipfile.ZipInfo("notes.txt")
    extra.external_attr = (stat.S_IFREG | 0o644) << 16
    mutated = tmp_path / "extra.octx"
    _rewrite_zip(package, mutated, extras=[(extra, b"ignored")])

    opened = open_octx(mutated)
    assert "notes.txt" not in opened.files
    assert validate_octx(opened).valid
    destination = unpack_octx(opened, tmp_path / "unpacked")
    assert not (destination / "notes.txt").exists()


def test_listed_payload_tampering_is_an_integrity_failure(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    mutated = tmp_path / "tampered.octx"
    _rewrite_zip(package, mutated, replace={"knowledge/guide.md": b"tampered"})

    report = validate_octx(mutated)
    assert not report.valid
    assert not report.format.valid
    assert "OCTX_FILE_DIGEST_MISMATCH" in report.issue_codes


def test_duplicate_manifest_keys_are_rejected(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    with zipfile.ZipFile(package) as archive:
        original = archive.read("manifest.json")
    duplicated = original.replace(b'"format": "octx"', b'"format": "octx", "format": "octx"', 1)
    mutated = tmp_path / "duplicate-key.octx"
    _rewrite_zip(package, mutated, replace={"manifest.json": duplicated})

    report = validate_octx(mutated)
    assert not report.valid
    assert "OCTX_JSON_DUPLICATE_KEY" in report.issue_codes


def test_archive_resource_limits_are_enforced(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    with pytest.raises(OctxResourceLimitError):
        open_octx(package, limits=ArchiveLimits(max_entries=1))

    compressible = zipfile.ZipInfo("large.txt")
    compressible.external_attr = (stat.S_IFREG | 0o644) << 16
    compressible.compress_type = zipfile.ZIP_DEFLATED
    mutated = tmp_path / "ratio.octx"
    _rewrite_zip(package, mutated, extras=[(compressible, b"0" * 200_000)])
    with pytest.raises(OctxResourceLimitError):
        open_octx(mutated, limits=ArchiveLimits(max_compression_ratio=5))


def test_open_rejects_non_nfc_paths(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    decomposed = zipfile.ZipInfo("knowledge/e\u0301.md")
    decomposed.external_attr = (stat.S_IFREG | 0o644) << 16
    mutated = tmp_path / "non-nfc.octx"
    _rewrite_zip(package, mutated, extras=[(decomposed, b"text")])
    with pytest.raises(OctxSecurityError):
        open_octx(mutated)


def test_open_rejects_unsupported_compression(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    entry = zipfile.ZipInfo("unsupported.bin")
    entry.external_attr = (stat.S_IFREG | 0o644) << 16
    entry.compress_type = zipfile.ZIP_BZIP2
    mutated = tmp_path / "bzip2.octx"
    _rewrite_zip(package, mutated, extras=[(entry, b"text")])
    with pytest.raises(OctxSecurityError):
        open_octx(mutated)


def test_open_rejects_encrypted_flags_before_reading(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    data = bytearray(package.read_bytes())
    for signature, flag_offset in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        offset = 0
        while (offset := data.find(signature, offset)) >= 0:
            flags = int.from_bytes(data[offset + flag_offset : offset + flag_offset + 2], "little") | 1
            data[offset + flag_offset : offset + flag_offset + 2] = flags.to_bytes(2, "little")
            offset += 4
    encrypted = tmp_path / "encrypted.octx"
    encrypted.write_bytes(data)
    with pytest.raises(OctxSecurityError):
        open_octx(encrypted)


def test_open_rejects_local_encryption_flag_when_central_header_is_clean(
    markdown_source: Path, tmp_path: Path
) -> None:
    package = _valid_package(markdown_source, tmp_path)
    data = bytearray(package.read_bytes())
    local_header = data.find(b"PK\x03\x04")
    assert local_header >= 0
    flags = int.from_bytes(data[local_header + 6 : local_header + 8], "little") | 1
    data[local_header + 6 : local_header + 8] = flags.to_bytes(2, "little")
    mutated = tmp_path / "local-encrypted.octx"
    mutated.write_bytes(data)

    with pytest.raises(OctxSecurityError, match="flags"):
        open_octx(mutated)


def test_open_rejects_local_compression_method_mismatch(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    data = bytearray(package.read_bytes())
    local_header = data.find(b"PK\x03\x04")
    assert local_header >= 0
    data[local_header + 8 : local_header + 10] = zipfile.ZIP_DEFLATED.to_bytes(2, "little")
    mutated = tmp_path / "local-method-mismatch.octx"
    mutated.write_bytes(data)

    with pytest.raises(OctxSecurityError, match="compression methods"):
        open_octx(mutated)


def test_open_rejects_dangerous_unlisted_local_filename(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    extra = zipfile.ZipInfo("safe.txt")
    extra.external_attr = (stat.S_IFREG | 0o644) << 16
    with_extra = tmp_path / "with-extra.octx"
    _rewrite_zip(package, with_extra, extras=[(extra, b"ignored")])
    with zipfile.ZipFile(with_extra) as archive:
        local_header = archive.getinfo("safe.txt").header_offset
    data = bytearray(with_extra.read_bytes())
    filename_size = int.from_bytes(data[local_header + 26 : local_header + 28], "little")
    assert filename_size == len(b"safe.txt")
    data[local_header + 30 : local_header + 30 + filename_size] = b"../a.txt"
    mutated = tmp_path / "dangerous-local-name.octx"
    mutated.write_bytes(data)

    with pytest.raises(OctxSecurityError):
        open_octx(mutated)


def test_zip_parser_errors_are_converted_to_octx_errors(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    data = bytearray(package.read_bytes())
    central_header = _central_header_offset(data, b"manifest.json")
    data[central_header + 6 : central_header + 8] = (0xFFFF).to_bytes(2, "little")
    mutated = tmp_path / "unsupported-zip-version.octx"
    mutated.write_bytes(data)

    with pytest.raises(OctxFormatError) as captured:
        open_octx(mutated)
    assert captured.value.code == "OCTX_ARCHIVE_INVALID"
    report = validate_octx(mutated)
    assert not report.valid
    assert "OCTX_ARCHIVE_INVALID" in report.issue_codes


def test_invalid_utf8_zip_filename_is_an_octx_format_error(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    with zipfile.ZipFile(package) as archive:
        local_header = archive.getinfo("manifest.json").header_offset
    data = bytearray(package.read_bytes())
    central_header = _central_header_offset(data, b"manifest.json")
    for flag_offset in (local_header + 6, central_header + 8):
        flags = int.from_bytes(data[flag_offset : flag_offset + 2], "little") | 0x800
        data[flag_offset : flag_offset + 2] = flags.to_bytes(2, "little")
    data[local_header + 30] = 0xFF
    data[central_header + 46] = 0xFF
    mutated = tmp_path / "invalid-utf8-name.octx"
    mutated.write_bytes(data)

    with pytest.raises(OctxFormatError) as captured:
        open_octx(mutated)
    assert captured.value.code == "OCTX_ARCHIVE_INVALID"


def test_corrupt_deflate_stream_returns_an_invalid_report(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    deflated = repack(package, tmp_path / "deflated.octx", compression=zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(deflated) as archive:
        info = archive.getinfo("manifest.json")
        local_header = info.header_offset
    data = bytearray(deflated.read_bytes())
    filename_size = int.from_bytes(data[local_header + 26 : local_header + 28], "little")
    extra_size = int.from_bytes(data[local_header + 28 : local_header + 30], "little")
    compressed_data = local_header + 30 + filename_size + extra_size
    data[compressed_data] = 0x06
    mutated = tmp_path / "corrupt-deflate.octx"
    mutated.write_bytes(data)

    with pytest.raises(OctxFormatError) as captured:
        open_octx(mutated)
    assert captured.value.code == "OCTX_ARCHIVE_CORRUPT"
    report = validate_octx(mutated)
    assert not report.valid
    assert "OCTX_ARCHIVE_CORRUPT" in report.issue_codes


def test_directory_reader_rejects_symlinks_even_when_unlisted(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "guide.octx")
    (workspace / "unlisted-link").symlink_to(workspace / "knowledge" / "guide.md")
    with pytest.raises(OctxSecurityError):
        open_octx(workspace)


def test_create_rejects_workspace_parent_symlinks_before_copying(tmp_path: Path) -> None:
    source = tmp_path / "source"
    (source / "sub").mkdir(parents=True)
    (source / "sub/doc.md").write_text("# Incoming\n", encoding="utf-8")
    victim = tmp_path / "victim"
    victim.mkdir()
    workspace = tmp_path / "workspace"
    (workspace / "knowledge").mkdir(parents=True)
    (workspace / "knowledge/sub").symlink_to(victim, target_is_directory=True)

    with pytest.raises(OctxSecurityError):
        create_octx(workspace, source=source, name="Unsafe", output=tmp_path / "unsafe.octx")

    assert not (victim / "doc.md").exists()


def test_create_does_not_silently_skip_unreadable_source_directories(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# Guide\n", encoding="utf-8")
    hidden = source / "hidden"
    hidden.mkdir()
    (hidden / "omitted.md").write_text("# Must not disappear\n", encoding="utf-8")
    hidden.chmod(0)
    try:
        with pytest.raises(OctxSecurityError):
            create_octx(
                tmp_path / "workspace",
                source=source,
                name="Unreadable",
                output=tmp_path / "unreadable.octx",
            )
    finally:
        hidden.chmod(0o700)


def test_corrupt_crc_returns_a_validation_report_instead_of_crashing(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    stored = repack(package, tmp_path / "stored.octx", compression=zipfile.ZIP_STORED)
    data = bytearray(stored.read_bytes())
    offset = data.find(b"Portable context.")
    assert offset > 0
    data[offset] ^= 1
    corrupt = tmp_path / "corrupt.octx"
    corrupt.write_bytes(data)

    report = validate_octx(corrupt)
    assert not report.valid
    assert "OCTX_ARCHIVE_CORRUPT" in report.issue_codes


def test_unpack_validates_before_creating_the_destination(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    tampered = tmp_path / "tampered.octx"
    _rewrite_zip(package, tampered, replace={"knowledge/guide.md": b"tampered"})
    destination = tmp_path / "must-not-exist"

    with pytest.raises(OctxValidationError):
        unpack_octx(tampered, destination)
    assert not destination.exists()


def test_file_and_total_size_limits_apply_to_all_archive_entries(markdown_source: Path, tmp_path: Path) -> None:
    package = _valid_package(markdown_source, tmp_path)
    with pytest.raises(OctxResourceLimitError):
        open_octx(package, limits=ArchiveLimits(max_file_size=32))
    with pytest.raises(OctxResourceLimitError):
        open_octx(package, limits=ArchiveLimits(max_total_uncompressed=32))


def test_payload_stream_rejects_directory_file_changes(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "guide.octx")
    package = open_octx(workspace, limits=ArchiveLimits(max_file_size=1024))
    (workspace / "knowledge/guide.md").write_bytes(b"x" * 2048)

    with pytest.raises(OctxSecurityError):
        package.open_payload("knowledge/guide.md")


def test_validation_limit_override_reopens_an_existing_package(markdown_source: Path, tmp_path: Path) -> None:
    opened = open_octx(_valid_package(markdown_source, tmp_path))
    strict_limits = ArchiveLimits(max_file_size=1)

    report = validate_octx(opened, limits=strict_limits)

    assert not report.valid
    assert "OCTX_RESOURCE_LIMIT" in report.issue_codes
    with pytest.raises(OctxResourceLimitError):
        unpack_octx(opened, tmp_path / "strict-unpack", limits=strict_limits)
