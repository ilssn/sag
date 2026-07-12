from __future__ import annotations

import os
import struct
import zipfile
from collections.abc import Callable
from pathlib import Path

import pytest

import octx.package as package_module
from octx import ArchiveLimits, create_octx, open_octx
from octx.errors import OctxFormatError, OctxResourceLimitError, OctxSecurityError

_EOCD = struct.Struct("<4s4H2LH")
_ZIP64_EOCD = struct.Struct("<4sQ2H2L4Q")
_ZIP64_LOCATOR = struct.Struct("<4sLQL")


def _valid_package(markdown_source: Path, tmp_path: Path) -> Path:
    return create_octx(
        tmp_path / "workspace",
        source=markdown_source,
        name="Guide",
        output=tmp_path / "guide.octx",
    ).output


def _eocd(
    *,
    entries: int = 0,
    directory_size: int = 0,
    directory_offset: int = 0,
    comment: bytes = b"",
) -> bytes:
    return _EOCD.pack(
        b"PK\x05\x06",
        0,
        0,
        entries,
        entries,
        directory_size,
        directory_offset,
        len(comment),
    ) + comment


def _zip64_eocd(*, entries: int, directory_size: int = 0) -> bytes:
    central_directory = b"x" * directory_size
    record_offset = len(central_directory)
    record = _ZIP64_EOCD.pack(
        b"PK\x06\x06",
        44,
        45,
        45,
        0,
        0,
        entries,
        entries,
        directory_size,
        0,
    )
    locator = _ZIP64_LOCATOR.pack(b"PK\x06\x07", 0, record_offset, 1)
    sentinel = _EOCD.pack(
        b"PK\x05\x06",
        0,
        0,
        0xFFFF,
        0xFFFF,
        0xFFFFFFFF,
        0xFFFFFFFF,
        0,
    )
    return central_directory + record + locator + sentinel


def _with_zip64_end(data: bytes) -> bytes:
    eocd_offset = data.rfind(b"PK\x05\x06")
    assert eocd_offset >= 0
    (
        _,
        _,
        _,
        entries_on_disk,
        entries_total,
        directory_size,
        directory_offset,
        comment_size,
    ) = _EOCD.unpack_from(data, eocd_offset)
    assert eocd_offset + _EOCD.size + comment_size == len(data)
    record_offset = directory_offset + directory_size
    record = _ZIP64_EOCD.pack(
        b"PK\x06\x06",
        44,
        45,
        45,
        0,
        0,
        entries_on_disk,
        entries_total,
        directory_size,
        directory_offset,
    )
    locator = _ZIP64_LOCATOR.pack(b"PK\x06\x07", 0, record_offset, 1)
    sentinel = _EOCD.pack(
        b"PK\x05\x06",
        0,
        0,
        0xFFFF,
        0xFFFF,
        0xFFFFFFFF,
        0xFFFFFFFF,
        comment_size,
    )
    return data[:eocd_offset] + record + locator + sentinel + data[eocd_offset + _EOCD.size :]


def _forbid_zipfile(monkeypatch: pytest.MonkeyPatch) -> Callable[[], int]:
    calls = 0

    def fail(*_: object, **__: object) -> None:
        nonlocal calls
        calls += 1
        raise AssertionError("ZipFile must not run before the archive preflight passes")

    monkeypatch.setattr(package_module.zipfile, "ZipFile", fail)
    return lambda: calls


def test_open_reuses_one_zipfile_and_closes_its_backing_file(
    markdown_source: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    original_init = zipfile.ZipFile.__init__
    calls = 0

    def count_init(self: zipfile.ZipFile, *args: object, **kwargs: object) -> None:
        nonlocal calls
        calls += 1
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(zipfile.ZipFile, "__init__", count_init)
    opened = open_octx(archive_path)
    backing_file = opened._archive_file
    assert backing_file is not None
    assert calls == 1

    first = opened.open_payload("knowledge/guide.md")
    second = opened.open_payload("knowledge/guide.md")
    try:
        assert first.read(8) == second.read(8)
        assert first.read() == second.read()
        assert opened.read_payload("knowledge/guide.md")
        assert calls == 1
    finally:
        first.close()
        second.close()
        opened.close()

    assert backing_file.closed
    opened.close()


def test_preflight_rejects_entry_count_before_zipfile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    archive_path = tmp_path / "too-many-entries.octx"
    archive_path.write_bytes(_eocd(entries=2))
    call_count = _forbid_zipfile(monkeypatch)

    with pytest.raises(OctxResourceLimitError, match="entry count"):
        open_octx(archive_path, limits=ArchiveLimits(max_entries=1))

    assert call_count() == 0


def test_preflight_counts_headers_instead_of_trusting_a_forged_low_count(
    markdown_source: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    data = bytearray(archive_path.read_bytes())
    eocd_offset = data.rfind(b"PK\x05\x06")
    assert eocd_offset >= 0
    struct.pack_into("<HH", data, eocd_offset + 8, 1, 1)
    forged = tmp_path / "forged-low-count.octx"
    forged.write_bytes(data)
    call_count = _forbid_zipfile(monkeypatch)

    with pytest.raises(OctxResourceLimitError, match="entry count"):
        open_octx(forged, limits=ArchiveLimits(max_entries=1))

    assert call_count() == 0


def test_preflight_rejects_a_count_mismatch_before_zipfile(
    markdown_source: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    data = bytearray(archive_path.read_bytes())
    eocd_offset = data.rfind(b"PK\x05\x06")
    assert eocd_offset >= 0
    struct.pack_into("<HH", data, eocd_offset + 8, 1, 1)
    forged = tmp_path / "forged-mismatched-count.octx"
    forged.write_bytes(data)
    call_count = _forbid_zipfile(monkeypatch)

    with pytest.raises(OctxFormatError, match="entry count"):
        open_octx(forged)

    assert call_count() == 0


def test_preflight_rejects_central_directory_size_before_zipfile(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path = tmp_path / "large-directory.octx"
    archive_path.write_bytes(_eocd(entries=1, directory_size=33))
    call_count = _forbid_zipfile(monkeypatch)

    with pytest.raises(OctxResourceLimitError, match="central directory"):
        open_octx(archive_path, limits=ArchiveLimits(max_file_size=32))

    assert call_count() == 0


def test_preflight_rejects_a_central_header_crossing_the_directory_boundary(
    markdown_source: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    data = bytearray(archive_path.read_bytes())
    eocd_offset = data.rfind(b"PK\x05\x06")
    assert eocd_offset >= 0
    directory_size = _EOCD.unpack_from(data, eocd_offset)[5]
    directory_start = eocd_offset - directory_size
    struct.pack_into("<H", data, directory_start + 28, 0xFFFF)
    malformed = tmp_path / "malformed-central-header.octx"
    malformed.write_bytes(data)
    call_count = _forbid_zipfile(monkeypatch)

    with pytest.raises(OctxFormatError, match="boundary"):
        open_octx(malformed)

    assert call_count() == 0


def test_preflight_reads_zip64_entry_count_before_zipfile(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_path = tmp_path / "zip64-too-many-entries.octx"
    archive_path.write_bytes(_zip64_eocd(entries=2))
    call_count = _forbid_zipfile(monkeypatch)

    with pytest.raises(OctxResourceLimitError, match="entry count"):
        open_octx(archive_path, limits=ArchiveLimits(max_entries=1))

    assert call_count() == 0


@pytest.mark.parametrize(
    "content",
    [
        b"PK\x05\x06\x00\x00",
        _EOCD.pack(b"PK\x05\x06", 0, 0, 0, 0, 0, 0, 10) + b"short",
        _ZIP64_LOCATOR.pack(b"PK\x06\x07", 0, 0, 1)
        + _EOCD.pack(b"PK\x05\x06", 0, 0, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0),
    ],
)
def test_preflight_rejects_truncated_zip_metadata_before_zipfile(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, content: bytes
) -> None:
    archive_path = tmp_path / "truncated.octx"
    archive_path.write_bytes(content)
    call_count = _forbid_zipfile(monkeypatch)

    with pytest.raises(OctxFormatError) as captured:
        open_octx(archive_path)

    assert captured.value.code == "OCTX_ARCHIVE_INVALID"
    assert call_count() == 0


def test_preflight_accepts_a_zip_comment(markdown_source: Path, tmp_path: Path) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    with zipfile.ZipFile(archive_path, "a") as archive:
        archive.comment = b"OCTX archive comment"

    with open_octx(archive_path) as opened:
        assert opened.read_payload("knowledge/guide.md")


def test_preflight_ignores_an_eocd_signature_inside_a_zip_comment(
    markdown_source: Path, tmp_path: Path
) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    with zipfile.ZipFile(archive_path, "a") as archive:
        archive.comment = b"valid comment with PK\x05\x06 marker inside"

    with open_octx(archive_path) as opened:
        assert opened.read_payload("knowledge/guide.md")


def test_preflight_accepts_zip64_with_prepended_data(markdown_source: Path, tmp_path: Path) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    prefixed = tmp_path / "prefixed-zip64.octx"
    prefixed.write_bytes(b"MZ-compatible-launcher\x00" + _with_zip64_end(archive_path.read_bytes()))

    with open_octx(prefixed) as opened:
        assert opened.read_payload("knowledge/guide.md")


def test_persistent_archive_rejects_source_replacement(markdown_source: Path, tmp_path: Path) -> None:
    archive_path = _valid_package(markdown_source, tmp_path)
    opened = open_octx(archive_path)
    replacement = tmp_path / "replacement.octx"
    replacement.write_bytes(archive_path.read_bytes())
    os.replace(replacement, archive_path)

    try:
        with pytest.raises(OctxSecurityError, match="changed"):
            opened.read_payload("knowledge/guide.md")
    finally:
        opened.close()
