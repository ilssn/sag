from __future__ import annotations

import copy
import os
import stat
import struct
import tempfile
import zipfile
import zlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, BinaryIO

if TYPE_CHECKING:
    import pyarrow as pa

from octx._documents import split_frontmatter
from octx._paths import is_concept_path, logical_path
from octx._strict import DuplicateKeyError, InvalidNumberError, loads_json
from octx.errors import OctxError, OctxFormatError, OctxResourceLimitError, OctxSecurityError
from octx.models import ArchiveLimits, Document

_SUPPORTED_COMPRESSION = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
_EOCD_SIGNATURE = b"PK\x05\x06"
_EOCD = struct.Struct("<4s4H2LH")
_ZIP64_EOCD_SIGNATURE = b"PK\x06\x06"
_ZIP64_EOCD = struct.Struct("<4sQ2H2L4Q")
_ZIP64_LOCATOR_SIGNATURE = b"PK\x06\x07"
_ZIP64_LOCATOR = struct.Struct("<4sLQL")
_CENTRAL_DIRECTORY_SIGNATURE = b"PK\x01\x02"
_CENTRAL_DIRECTORY_HEADER = struct.Struct("<4s24x3H12x")
_LOCAL_FILE_HEADER_SIGNATURE = b"PK\x03\x04"
_LOCAL_FILE_HEADER = struct.Struct("<4s5H3L2H")
_MAX_ZIP_COMMENT_SIZE = (1 << 16) - 1


class _ZipCommentlessView:
    """Hide a validated ZIP comment from stdlib parsers that misread EOCD-like comment bytes."""

    def __init__(self, file: BinaryIO, eocd_offset: int) -> None:
        self._file = file
        self._eocd_offset = eocd_offset
        self._visible_size = eocd_offset + _EOCD.size

    @property
    def name(self) -> str | None:
        return getattr(self._file, "name", None)

    def tell(self) -> int:
        return self._file.tell()

    def seekable(self) -> bool:
        return True

    def readable(self) -> bool:
        return True

    def writable(self) -> bool:
        return False

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        if whence == os.SEEK_SET:
            target = offset
        elif whence == os.SEEK_CUR:
            target = self.tell() + offset
        elif whence == os.SEEK_END:
            target = self._visible_size + offset
        else:
            raise ValueError(f"unsupported seek mode: {whence}")
        if target < 0:
            raise ValueError("negative seek position")
        return self._file.seek(target)

    def read(self, size: int = -1) -> bytes:
        start = self.tell()
        if start >= self._visible_size:
            return b""
        remaining = self._visible_size - start
        requested = remaining if size < 0 else min(size, remaining)
        data = self._file.read(requested)
        comment_length_offset = self._eocd_offset + _EOCD.size - 2
        overlap_start = max(start, comment_length_offset)
        overlap_end = min(start + len(data), comment_length_offset + 2)
        if overlap_start < overlap_end:
            mutable = bytearray(data)
            mutable[overlap_start - start : overlap_end - start] = b"\x00" * (overlap_end - overlap_start)
            return bytes(mutable)
        return data


def _flatbuffer_field(data: bytes, table: int, index: int) -> int:
    if table < 0 or table + 4 > len(data):
        raise ValueError("invalid FlatBuffer table")
    vtable = table - struct.unpack_from("<i", data, table)[0]
    if vtable < 0 or vtable + 4 > len(data):
        raise ValueError("invalid FlatBuffer vtable")
    vtable_size = struct.unpack_from("<H", data, vtable)[0]
    location = vtable + 4 + 2 * index
    if location + 2 > vtable + vtable_size or location + 2 > len(data):
        return 0
    return struct.unpack_from("<H", data, location)[0]


def _arrow_message_metadata(metadata: bytes) -> tuple[int, int, bool]:
    if len(metadata) < 4:
        raise ValueError("Arrow message metadata is truncated")
    message = struct.unpack_from("<I", metadata, 0)[0]
    header_type_offset = _flatbuffer_field(metadata, message, 1)
    header_offset = _flatbuffer_field(metadata, message, 2)
    body_length_offset = _flatbuffer_field(metadata, message, 3)
    if not header_type_offset or not header_offset:
        raise ValueError("Arrow message header is missing")
    header_type = metadata[message + header_type_offset]
    header_location = message + header_offset
    header = header_location + struct.unpack_from("<I", metadata, header_location)[0]
    body_length = (
        struct.unpack_from("<q", metadata, message + body_length_offset)[0] if body_length_offset else 0
    )
    record_batch = header
    if header_type == 2:
        data_offset = _flatbuffer_field(metadata, header, 1)
        if not data_offset:
            raise ValueError("Arrow dictionary batch data is missing")
        data_location = header + data_offset
        record_batch = data_location + struct.unpack_from("<I", metadata, data_location)[0]
    compressed = header_type in {2, 3} and _flatbuffer_field(metadata, record_batch, 3) != 0
    return header_type, body_length, compressed


def _validate_arrow_messages(
    file: BinaryIO,
    expected_record_batches: int,
    path: str,
    limits: ArchiveLimits,
) -> None:
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    if file_size < 18:
        raise OctxFormatError("Arrow IPC file is truncated", path=path, code="OCTX_VECTOR_ARROW_INVALID")
    file.seek(file_size - 10)
    footer_size = struct.unpack("<i", file.read(4))[0]
    if footer_size < 0 or footer_size > file_size - 18 or file.read(6) != b"ARROW1":
        raise OctxFormatError("invalid Arrow IPC file footer", path=path, code="OCTX_VECTOR_ARROW_INVALID")
    footer_start = file_size - 10 - footer_size
    file.seek(0)
    if file.read(8) != b"ARROW1\x00\x00":
        raise OctxFormatError("invalid Arrow IPC file magic", path=path, code="OCTX_VECTOR_ARROW_INVALID")

    schema_messages = 0
    record_batches = 0
    data_batches = 0
    while file.tell() < footer_start:
        prefix = file.read(4)
        if len(prefix) != 4:
            raise OctxFormatError("Arrow message prefix is truncated", path=path, code="OCTX_VECTOR_ARROW_INVALID")
        metadata_size = struct.unpack("<i", prefix)[0]
        if metadata_size == -1:
            size_bytes = file.read(4)
            if len(size_bytes) != 4:
                raise OctxFormatError(
                    "Arrow message length is truncated", path=path, code="OCTX_VECTOR_ARROW_INVALID"
                )
            metadata_size = struct.unpack("<i", size_bytes)[0]
        if metadata_size == 0:
            if file.tell() != footer_start:
                raise OctxFormatError(
                    "Arrow end-of-stream marker precedes message data",
                    path=path,
                    code="OCTX_VECTOR_ARROW_INVALID",
                )
            break
        if metadata_size <= 0 or metadata_size > limits.max_file_size:
            raise OctxResourceLimitError("Arrow message metadata exceeds configured limit", path=path)
        if file.tell() + metadata_size > footer_start:
            raise OctxFormatError("Arrow message metadata is truncated", path=path, code="OCTX_VECTOR_ARROW_INVALID")
        metadata = file.read(metadata_size)
        if len(metadata) != metadata_size:
            raise OctxFormatError("Arrow message metadata is truncated", path=path, code="OCTX_VECTOR_ARROW_INVALID")
        try:
            header_type, body_length, compressed = _arrow_message_metadata(metadata)
        except (IndexError, struct.error, ValueError) as error:
            raise OctxFormatError(
                f"invalid Arrow message metadata: {error}", path=path, code="OCTX_VECTOR_ARROW_INVALID"
            ) from error
        if header_type not in {1, 2, 3}:
            raise OctxFormatError(
                "Arrow IPC file contains an unsupported message type",
                path=path,
                code="OCTX_VECTOR_ARROW_INVALID",
            )
        if schema_messages == 0:
            if header_type != 1:
                raise OctxFormatError(
                    "Arrow IPC file must begin with a schema message",
                    path=path,
                    code="OCTX_VECTOR_ARROW_INVALID",
                )
            schema_messages = 1
        elif header_type == 1:
            raise OctxFormatError(
                "Arrow IPC file contains multiple schema messages",
                path=path,
                code="OCTX_VECTOR_ARROW_INVALID",
            )
        else:
            data_batches += 1
            if data_batches > limits.max_arrow_batches:
                raise OctxResourceLimitError("Arrow batch count exceeds configured limit", path=path)
            if header_type == 3:
                record_batches += 1
        if compressed:
            raise OctxFormatError(
                "Arrow IPC body compression is not supported by OCTX vectors/0.1",
                path=path,
                code="OCTX_VECTOR_COMPRESSION_UNSUPPORTED",
            )
        if body_length < 0 or file.tell() + body_length > footer_start:
            raise OctxFormatError("Arrow message body is truncated", path=path, code="OCTX_VECTOR_ARROW_INVALID")
        file.seek(body_length, os.SEEK_CUR)
    if schema_messages != 1 or record_batches != expected_record_batches:
        raise OctxFormatError(
            "Arrow record batch messages do not match the file footer",
            path=path,
            code="OCTX_VECTOR_ARROW_INVALID",
        )


class _LimitedStream:
    def __init__(
        self,
        stream: BinaryIO,
        *,
        limit: int,
        path: str,
        close_callbacks: tuple[Callable[[], None], ...] = (),
        verify_callback: Callable[[], None] | None = None,
    ) -> None:
        self._stream = stream
        self._limit = limit
        self._path = path
        self._read = 0
        self._close_callbacks = close_callbacks
        self._verify_callback = verify_callback

    def __enter__(self) -> _LimitedStream:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def __iter__(self) -> _LimitedStream:
        return self

    def __next__(self) -> bytes:
        line = self.readline()
        if not line:
            raise StopIteration
        return line

    @property
    def closed(self) -> bool:
        return self._stream.closed

    def readable(self) -> bool:
        return True

    def writable(self) -> bool:
        return False

    def seekable(self) -> bool:
        return self._stream.seekable()

    def seek(self, offset: int, whence: int = os.SEEK_SET) -> int:
        return self._stream.seek(offset, whence)

    def tell(self) -> int:
        return self._stream.tell()

    def fileno(self) -> int:
        return self._stream.fileno()

    def read(self, size: int = -1) -> bytes:
        remaining = self._limit - self._read
        requested = remaining + 1 if size < 0 else min(size, remaining + 1)
        try:
            data = self._stream.read(requested)
        except (zipfile.BadZipFile, RuntimeError, EOFError, OSError, zlib.error) as error:
            if self._verify_callback is not None:
                try:
                    self._verify_callback()
                except Exception:
                    self.close()
                    raise
            self.close()
            raise OctxFormatError(
                f"package file could not be read safely: {error}",
                path=self._path,
                code="OCTX_ARCHIVE_CORRUPT",
            ) from error
        if self._verify_callback is not None:
            try:
                self._verify_callback()
            except Exception:
                self.close()
                raise
        self._count(data)
        return data

    def read1(self, size: int = -1) -> bytes:
        return self.read(size)

    def readall(self) -> bytes:
        return self.read()

    def readinto(self, buffer: bytearray | memoryview) -> int:
        data = self.read(len(buffer))
        buffer[: len(data)] = data
        return len(data)

    def readline(self, size: int = -1) -> bytes:
        remaining = self._limit - self._read
        requested = remaining + 1 if size < 0 else min(size, remaining + 1)
        try:
            data = self._stream.readline(requested)
        except (zipfile.BadZipFile, RuntimeError, EOFError, OSError, zlib.error) as error:
            if self._verify_callback is not None:
                try:
                    self._verify_callback()
                except Exception:
                    self.close()
                    raise
            self.close()
            raise OctxFormatError(
                f"package file could not be read safely: {error}",
                path=self._path,
                code="OCTX_ARCHIVE_CORRUPT",
            ) from error
        if self._verify_callback is not None:
            try:
                self._verify_callback()
            except Exception:
                self.close()
                raise
        self._count(data)
        return data

    def _count(self, data: bytes) -> None:
        self._read += len(data)
        if self._read > self._limit:
            self.close()
            raise OctxResourceLimitError("file exceeds configured size limit", path=self._path)

    def close(self) -> None:
        try:
            self._stream.close()
        finally:
            for callback in self._close_callbacks:
                callback()


class OctxPackage:
    """Read-only view over a safe OCTX archive or working directory."""

    def __init__(
        self,
        source: Path,
        *,
        limits: ArchiveLimits,
        kind: str,
        entries: dict[str, Any],
        manifest: dict[str, Any],
        source_signature: tuple[int, ...] | None = None,
        archive_file: BinaryIO | None = None,
        archive: zipfile.ZipFile | None = None,
    ) -> None:
        self.source = source
        self.limits = limits
        self.source_kind = kind
        self._entries = entries
        self._available_paths = frozenset(entries)
        self._source_signature = source_signature
        self._archive_file = archive_file
        self._archive = archive
        self._closed = False
        self._set_manifest(manifest)

    def _set_manifest(self, manifest: dict[str, Any]) -> None:
        manifest_files = manifest.get("files")
        if isinstance(manifest_files, list) and len(manifest_files) + 1 > self.limits.max_entries:
            raise OctxResourceLimitError("manifest file count exceeds configured entry limit", path="manifest.json")
        listed_paths = self._extract_listed_paths(manifest)
        self._manifest = manifest
        self._listed_paths = listed_paths
        self._listed_path_set = frozenset(self._listed_paths)

    @staticmethod
    def _extract_listed_paths(manifest: dict[str, Any]) -> tuple[str, ...]:
        values = manifest.get("files")
        if not isinstance(values, list):
            return ()
        paths: list[str] = []
        seen: set[str] = set()
        for item in values:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                continue
            path = logical_path(item["path"])
            if path in seen:
                raise OctxFormatError("manifest contains duplicate file paths", path=path)
            seen.add(path)
            paths.append(path)
        return tuple(paths)

    @property
    def manifest(self) -> dict[str, Any]:
        self._ensure_open()
        return copy.deepcopy(self._manifest)

    @property
    def files(self) -> tuple[str, ...]:
        self._ensure_open()
        return self._listed_paths

    @property
    def available_paths(self) -> frozenset[str]:
        self._ensure_open()
        return self._available_paths

    def __enter__(self) -> OctxPackage:
        self._ensure_open()
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        archive = self._archive
        archive_file = self._archive_file
        self._archive = None
        self._archive_file = None
        try:
            if archive is not None:
                archive.close()
        finally:
            if archive_file is not None:
                archive_file.close()

    def _ensure_open(self) -> None:
        if self._closed:
            raise ValueError("OCTX package is closed")

    def _verify_source_unchanged(self) -> None:
        if self._source_signature is None:
            return
        current = _safe_lstat(self.source)
        signature = _directory_signature(current) if self.source_kind == "directory" else _file_signature(current)
        if signature != self._source_signature:
            raise OctxSecurityError("archive changed after it was opened", path=str(self.source))

    def _verify_archive_unchanged(self) -> None:
        self._verify_source_unchanged()
        archive_file = self._archive_file
        if archive_file is None or archive_file.closed:
            raise ValueError("OCTX package is closed")
        try:
            signature = _file_signature(os.fstat(archive_file.fileno()))
        except OSError as error:
            raise OctxSecurityError("archive cannot be inspected safely", path=str(self.source)) from error
        if signature != self._source_signature:
            raise OctxSecurityError("archive changed while it was read", path=str(self.source))

    def _open_directory_entry(self, path: str) -> tuple[BinaryIO, tuple[int, ...]]:
        self._verify_source_unchanged()
        candidate, expected_signature = self._entries[path]
        no_follow = getattr(os, "O_NOFOLLOW", 0)
        directory_flag = getattr(os, "O_DIRECTORY", 0)
        supports_openat = os.open in os.supports_dir_fd and no_follow and directory_flag
        if not supports_openat:
            parent = candidate.parent
            while parent != self.source:
                if parent.is_symlink():
                    raise OctxSecurityError("working directory path contains a symbolic link", path=path)
                parent = parent.parent
            descriptor = os.open(candidate, os.O_RDONLY | no_follow)
            if _file_signature(os.fstat(descriptor)) != expected_signature:
                os.close(descriptor)
                raise OctxSecurityError("working directory file changed after open", path=path)
            return os.fdopen(descriptor, "rb"), expected_signature

        current = os.open(self.source, os.O_RDONLY | no_follow | directory_flag)
        try:
            if _directory_signature(os.fstat(current)) != self._source_signature:
                raise OctxSecurityError("working directory changed after it was opened", path=str(self.source))
            parts = path.split("/")
            for part in parts[:-1]:
                following = os.open(part, os.O_RDONLY | no_follow | directory_flag, dir_fd=current)
                os.close(current)
                current = following
            descriptor = os.open(parts[-1], os.O_RDONLY | no_follow, dir_fd=current)
        finally:
            os.close(current)
        if _file_signature(os.fstat(descriptor)) != expected_signature:
            os.close(descriptor)
            raise OctxSecurityError("working directory file changed after open", path=path)
        return os.fdopen(descriptor, "rb"), expected_signature

    def _open_any(self, path: str) -> BinaryIO:
        self._ensure_open()
        path = logical_path(path)
        if path not in self._entries:
            raise OctxFormatError("package file is missing", path=path, code="OCTX_FILE_MISSING")
        if self.source_kind == "directory":
            try:
                stream, expected_signature = self._open_directory_entry(path)
            except OSError as error:
                raise OctxSecurityError("working directory file cannot be safely opened", path=path) from error
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode):
                stream.close()
                raise OctxSecurityError("working directory entry is no longer a regular file", path=path)

            def verify() -> None:
                if _file_signature(os.fstat(stream.fileno())) != expected_signature:
                    raise OctxSecurityError("working directory file changed while it was read", path=path)

            return _LimitedStream(  # type: ignore[return-value]
                stream,
                limit=self.limits.max_file_size,
                path=path,
                verify_callback=verify,
            )
        self._verify_archive_unchanged()
        archive = self._archive
        if archive is None:
            raise ValueError("OCTX package is closed")
        try:
            stream = archive.open(self._entries[path], "r")
        except (zipfile.BadZipFile, RuntimeError, EOFError, OSError) as error:
            self._verify_archive_unchanged()
            raise OctxFormatError(
                f"package file could not be read safely: {error}", path=path, code="OCTX_ARCHIVE_CORRUPT"
            ) from error
        try:
            self._verify_archive_unchanged()
        except Exception:
            stream.close()
            raise

        def verify() -> None:
            self._verify_archive_unchanged()

        return _LimitedStream(  # type: ignore[return-value]
            stream,
            limit=self.limits.max_file_size,
            path=path,
            verify_callback=verify,
        )

    def _read_any(self, path: str) -> bytes:
        try:
            with self._open_any(path) as stream:
                chunks: list[bytes] = []
                total = 0
                while True:
                    chunk = stream.read(min(1024 * 1024, self.limits.max_file_size + 1 - total))
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > self.limits.max_file_size:
                        raise OctxResourceLimitError("file exceeds configured size limit", path=path)
                    chunks.append(chunk)
                return b"".join(chunks)
        except (zipfile.BadZipFile, RuntimeError, EOFError, OSError) as error:
            raise OctxFormatError(
                f"package file could not be read safely: {error}", path=path, code="OCTX_ARCHIVE_CORRUPT"
            ) from error

    def open_payload(self, path: str) -> BinaryIO:
        path = logical_path(path)
        if path not in self._listed_path_set:
            raise KeyError(f"payload is not listed in manifest: {path}")
        return self._open_any(path)

    def read_payload(self, path: str) -> bytes:
        path = logical_path(path)
        if path not in self._listed_path_set:
            raise KeyError(f"payload is not listed in manifest: {path}")
        return self._read_any(path)

    def iter_documents(self) -> Iterator[Document]:
        for path in sorted((value for value in self._listed_paths if is_concept_path(value)), key=str.encode):
            raw = self._read_any(path)
            try:
                metadata, body = split_frontmatter(raw, path=path, max_depth=self.limits.max_yaml_depth)
            except Exception as error:
                raise OctxFormatError(str(error), path=path, code="OCTX_DOCUMENT_FRONTMATTER") from error
            yield Document(path=path, metadata=metadata, body=body, raw=raw)

    def iter_jsonl(self, path: str) -> Iterator[dict[str, Any]]:
        for line_number, raw_line in self._iter_jsonl_lines(path):
            if not raw_line.strip():
                raise OctxFormatError(
                    "JSONL contains an empty line",
                    path=path,
                    line=line_number,
                    code="OCTX_JSONL_EMPTY_LINE",
                )
            try:
                value = loads_json(raw_line, path=path, max_depth=self.limits.max_json_depth)
            except DuplicateKeyError as error:
                raise OctxFormatError(
                    str(error), path=path, line=line_number, code="OCTX_JSON_DUPLICATE_KEY"
                ) from error
            except (UnicodeError, InvalidNumberError, ValueError) as error:
                raise OctxFormatError(str(error), path=path, line=line_number, code="OCTX_JSON_INVALID") from error
            if not isinstance(value, dict):
                raise OctxFormatError(
                    "JSONL record must be an object",
                    path=path,
                    line=line_number,
                    code="OCTX_JSONL_RECORD_TYPE",
                )
            yield value

    def _iter_jsonl_lines(self, path: str) -> Iterator[tuple[int, bytes]]:
        with self.open_payload(path) as stream:
            line_number = 0
            while True:
                raw_line = stream.readline(self.limits.max_jsonl_line_size + 3)
                if not raw_line:
                    return
                line_number += 1
                if line_number > self.limits.max_jsonl_records:
                    raise OctxResourceLimitError("JSONL record count exceeds configured limit", path=path)
                if raw_line.endswith(b"\n"):
                    raw_line = raw_line[:-1]
                    if raw_line.endswith(b"\r"):
                        raw_line = raw_line[:-1]
                if len(raw_line) > self.limits.max_jsonl_line_size:
                    raise OctxResourceLimitError("JSONL line exceeds configured size limit", path=path)
                yield line_number, raw_line

    def iter_chunks(self) -> Iterator[dict[str, Any]]:
        return self.iter_jsonl("data/chunks.jsonl")

    def iter_events(self) -> Iterator[dict[str, Any]]:
        return self.iter_jsonl("data/events.jsonl")

    def iter_entities(self) -> Iterator[dict[str, Any]]:
        return self.iter_jsonl("data/entities.jsonl")

    def iter_chunk_events(self) -> Iterator[dict[str, Any]]:
        return self.iter_jsonl("relations/chunk-events.jsonl")

    def iter_event_entities(self) -> Iterator[dict[str, Any]]:
        return self.iter_jsonl("relations/event-entities.jsonl")

    @contextmanager
    def _open_vector_reader(self, target: str) -> Iterator[Any]:
        if target not in {"chunks", "events", "entities"}:
            raise ValueError("vector target must be chunks, events, or entities")
        try:
            import pyarrow as pa
            import pyarrow.ipc as ipc
        except ImportError as error:
            raise OctxFormatError(
                "vector support requires the 'vectors' extra",
                path=f"vectors/{target}.arrow",
                code="OCTX_VECTOR_SUPPORT_UNAVAILABLE",
            ) from error
        path = f"vectors/{target}.arrow"
        temporary = tempfile.TemporaryFile()
        try:
            with self.open_payload(path) as incoming:
                while chunk := incoming.read(1024 * 1024):
                    temporary.write(chunk)
            temporary.seek(0)
            reader = ipc.open_file(temporary)
            if reader.num_record_batches > self.limits.max_arrow_batches:
                raise OctxResourceLimitError(
                    "Arrow batch count exceeds configured limit", path=path
                )
            if reader.schema.names.count("vector") == 1:
                vector_type = reader.schema.field("vector").type
                if pa.types.is_fixed_size_list(vector_type) and vector_type.list_size > self.limits.max_arrow_dimension:
                    raise OctxResourceLimitError("Arrow vector dimension exceeds configured limit", path=path)
            _validate_arrow_messages(temporary, reader.num_record_batches, path, self.limits)
            yield reader
        except OctxResourceLimitError:
            raise
        except OctxError:
            raise
        except Exception as error:
            raise OctxFormatError(
                f"invalid Arrow IPC file: {error}",
                path=path,
                code="OCTX_VECTOR_ARROW_INVALID",
            ) from error
        finally:
            temporary.close()

    def read_vector_table(self, target: str) -> pa.Table:
        try:
            import pyarrow as pa
        except ImportError as error:
            raise OctxFormatError(
                "vector support requires the 'vectors' extra",
                path=f"vectors/{target}.arrow",
                code="OCTX_VECTOR_SUPPORT_UNAVAILABLE",
            ) from error
        with self._open_vector_reader(target) as reader:
            batches = list(self._iter_reader_batches(target, reader))
            return pa.Table.from_batches(batches, schema=reader.schema)

    def _iter_reader_batches(self, target: str, reader: Any) -> Iterator[pa.RecordBatch]:
        path = f"vectors/{target}.arrow"
        total_rows = 0
        total_values = 0
        decoded_bytes = 0
        schema = reader.schema
        dimension = None
        if schema.names.count("vector") == 1:
            try:
                import pyarrow as pa
            except ImportError:  # pragma: no cover - handled by _open_vector_reader
                return
            vector_type = schema.field("vector").type
            if pa.types.is_fixed_size_list(vector_type):
                dimension = vector_type.list_size
        for index in range(reader.num_record_batches):
            try:
                batch = reader.get_batch(index)
            except Exception as error:
                raise OctxFormatError(
                    f"invalid Arrow IPC record batch: {error}",
                    path=path,
                    code="OCTX_VECTOR_ARROW_INVALID",
                ) from error
            total_rows += batch.num_rows
            decoded_bytes += batch.nbytes
            if dimension is not None:
                total_values += batch.num_rows * dimension
            if total_rows > self.limits.max_arrow_rows:
                raise OctxResourceLimitError("Arrow row count exceeds configured limit", path=path)
            if total_values > self.limits.max_arrow_values:
                raise OctxResourceLimitError("Arrow vector value count exceeds configured limit", path=path)
            if decoded_bytes > self.limits.max_total_uncompressed:
                raise OctxResourceLimitError("Arrow decoded data exceeds configured limit", path=path)
            yield batch

    def iter_vector_batches(self, target: str) -> Iterator[pa.RecordBatch]:
        with self._open_vector_reader(target) as reader:
            yield from self._iter_reader_batches(target, reader)


def _parse_manifest(data: bytes, limits: ArchiveLimits) -> dict[str, Any]:
    try:
        manifest = loads_json(data, path="manifest.json", max_depth=limits.max_json_depth)
    except DuplicateKeyError as error:
        raise OctxFormatError(str(error), path="manifest.json", code="OCTX_JSON_DUPLICATE_KEY") from error
    except (UnicodeError, InvalidNumberError, ValueError) as error:
        raise OctxFormatError(str(error), path="manifest.json", code="OCTX_MANIFEST_JSON_INVALID") from error
    if not isinstance(manifest, dict):
        raise OctxFormatError("manifest.json must contain a JSON object", path="manifest.json")
    return manifest


def _file_signature(metadata: os.stat_result) -> tuple[int, ...]:
    return metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns


def _safe_lstat(path: Path, *, logical: str | None = None) -> os.stat_result:
    try:
        return path.lstat()
    except OSError as error:
        raise OctxSecurityError("package path changed while it was inspected", path=logical or str(path)) from error


def _directory_signature(metadata: os.stat_result) -> tuple[int, ...]:
    return metadata.st_dev, metadata.st_ino


def _invalid_archive(source: Path, message: str) -> OctxFormatError:
    return OctxFormatError(f"invalid OCTX ZIP: {message}", path=str(source), code="OCTX_ARCHIVE_INVALID")


def _read_archive_at(file: BinaryIO, offset: int, size: int, source: Path) -> bytes:
    if offset < 0:
        raise _invalid_archive(source, "ZIP metadata offset is invalid")
    try:
        file.seek(offset)
        data = file.read(size)
    except (OSError, ValueError) as error:
        raise _invalid_archive(source, f"ZIP metadata could not be read: {error}") from error
    if len(data) != size:
        raise _invalid_archive(source, "ZIP metadata is truncated")
    return data


def _find_eocd(file: BinaryIO, source: Path) -> tuple[tuple[int, int, int, int, int, int], int]:
    try:
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
    except (OSError, ValueError) as error:
        raise _invalid_archive(source, f"ZIP length could not be read: {error}") from error
    if file_size < _EOCD.size:
        raise _invalid_archive(source, "end of central directory is missing")
    tail_size = min(file_size, _EOCD.size + _MAX_ZIP_COMMENT_SIZE)
    tail = _read_archive_at(file, file_size - tail_size, tail_size, source)
    candidates: list[tuple[int, tuple[bytes, int, int, int, int, int, int, int]]] = []
    cursor = 0
    while (offset := tail.find(_EOCD_SIGNATURE, cursor)) >= 0:
        cursor = offset + 1
        if offset + _EOCD.size > len(tail):
            continue
        values = _EOCD.unpack_from(tail, offset)
        comment_size = values[-1]
        absolute_offset = file_size - tail_size + offset
        if absolute_offset + _EOCD.size + comment_size == file_size:
            candidates.append((absolute_offset, values))
    if not candidates:
        raise _invalid_archive(source, "end of central directory is missing or truncated")
    if len(candidates) != 1:
        raise _invalid_archive(source, "end of central directory is ambiguous")
    absolute_offset, values = candidates[0]
    (
        _,
        disk_number,
        directory_disk,
        entries_on_disk,
        entries_total,
        directory_size,
        directory_offset,
        _,
    ) = values
    return (
        disk_number,
        directory_disk,
        entries_on_disk,
        entries_total,
        directory_size,
        directory_offset,
    ), absolute_offset


def _read_zip64_directory(
    file: BinaryIO, eocd_offset: int, source: Path
) -> tuple[int, int, int, int] | None:
    locator_offset = eocd_offset - _ZIP64_LOCATOR.size
    if locator_offset < 0:
        return None
    locator = _read_archive_at(file, locator_offset, _ZIP64_LOCATOR.size, source)
    if not locator.startswith(_ZIP64_LOCATOR_SIGNATURE):
        return None
    try:
        _, locator_disk, relative_record_offset, disk_count = _ZIP64_LOCATOR.unpack(locator)
    except struct.error as error:
        raise _invalid_archive(source, "ZIP64 locator is malformed") from error
    if locator_disk != 0 or disk_count != 1:
        raise _invalid_archive(source, "multi-disk ZIP archives are not supported")

    latest_record_offset = locator_offset - _ZIP64_EOCD.size
    if latest_record_offset < 0 or relative_record_offset > latest_record_offset:
        raise _invalid_archive(source, "ZIP64 locator points outside the archive")
    record_offset = relative_record_offset
    extensible_size = latest_record_offset - relative_record_offset
    record = _read_archive_at(file, record_offset, _ZIP64_EOCD.size, source)
    if not record.startswith(_ZIP64_EOCD_SIGNATURE) and record_offset != latest_record_offset:
        record_offset = latest_record_offset
        extensible_size = 0
        record = _read_archive_at(file, record_offset, _ZIP64_EOCD.size, source)
    if not record.startswith(_ZIP64_EOCD_SIGNATURE):
        raise _invalid_archive(source, "ZIP64 end of central directory is missing")
    try:
        (
            _,
            record_size,
            _,
            _,
            disk_number,
            directory_disk,
            entries_on_disk,
            entries_total,
            directory_size,
            directory_offset,
        ) = _ZIP64_EOCD.unpack(record)
    except struct.error as error:
        raise _invalid_archive(source, "ZIP64 end of central directory is malformed") from error
    if disk_number != 0 or directory_disk != 0 or entries_on_disk != entries_total:
        raise _invalid_archive(source, "multi-disk ZIP archives are not supported")
    if record_size + 12 != _ZIP64_EOCD.size + extensible_size:
        raise _invalid_archive(source, "ZIP64 end of central directory size is inconsistent")
    if directory_offset + directory_size != relative_record_offset:
        raise _invalid_archive(source, "ZIP64 central directory offset is inconsistent")
    return entries_total, directory_size, directory_offset, record_offset


def _count_central_directory_entries(
    file: BinaryIO,
    source: Path,
    *,
    directory_start: int,
    directory_size: int,
    limits: ArchiveLimits,
) -> int:
    cursor = directory_start
    directory_end = directory_start + directory_size
    count = 0
    while cursor < directory_end:
        remaining = directory_end - cursor
        if remaining < _CENTRAL_DIRECTORY_HEADER.size:
            raise _invalid_archive(source, "central directory header is truncated")
        header = _read_archive_at(file, cursor, _CENTRAL_DIRECTORY_HEADER.size, source)
        try:
            signature, filename_size, extra_size, comment_size = _CENTRAL_DIRECTORY_HEADER.unpack(header)
        except struct.error as error:
            raise _invalid_archive(source, "central directory header is malformed") from error
        if signature != _CENTRAL_DIRECTORY_SIGNATURE:
            raise _invalid_archive(source, "central directory header signature is invalid")
        record_size = _CENTRAL_DIRECTORY_HEADER.size + filename_size + extra_size + comment_size
        if record_size > remaining:
            raise _invalid_archive(source, "central directory entry exceeds its declared boundary")
        count += 1
        if count > limits.max_entries:
            raise OctxResourceLimitError("archive entry count exceeds configured limit", path=str(source))
        cursor += record_size
    return count


def _preflight_zip(file: BinaryIO, source: Path, limits: ArchiveLimits) -> tuple[int, int, int]:
    (
        disk_number,
        directory_disk,
        entries_on_disk,
        entries_total,
        directory_size,
        directory_offset,
    ), eocd_offset = _find_eocd(file, source)
    if disk_number != 0 or directory_disk != 0 or entries_on_disk != entries_total:
        raise _invalid_archive(source, "multi-disk ZIP archives are not supported")

    zip64 = _read_zip64_directory(file, eocd_offset, source)
    uses_zip64_sentinel = (
        entries_on_disk == 0xFFFF
        or entries_total == 0xFFFF
        or directory_size == 0xFFFFFFFF
        or directory_offset == 0xFFFFFFFF
    )
    if zip64 is None:
        if uses_zip64_sentinel:
            raise _invalid_archive(source, "ZIP64 metadata is missing")
        central_directory_end = eocd_offset
    else:
        zip64_entries, zip64_size, zip64_offset, central_directory_end = zip64
        legacy_values = (
            (entries_on_disk, 0xFFFF, zip64_entries),
            (entries_total, 0xFFFF, zip64_entries),
            (directory_size, 0xFFFFFFFF, zip64_size),
            (directory_offset, 0xFFFFFFFF, zip64_offset),
        )
        if any(legacy not in {sentinel, current} for legacy, sentinel, current in legacy_values):
            raise _invalid_archive(source, "ZIP64 and legacy central directory values are inconsistent")
        entries_total, directory_size, directory_offset = zip64_entries, zip64_size, zip64_offset

    if entries_total > limits.max_entries:
        raise OctxResourceLimitError("archive entry count exceeds configured limit", path=str(source))
    if directory_size > limits.max_file_size:
        raise OctxResourceLimitError("archive central directory exceeds configured size limit", path=str(source))
    if directory_offset + directory_size > central_directory_end:
        raise _invalid_archive(source, "central directory points outside the archive")
    directory_start = central_directory_end - directory_size
    actual_entries = _count_central_directory_entries(
        file,
        source,
        directory_start=directory_start,
        directory_size=directory_size,
        limits=limits,
    )
    if actual_entries != entries_total:
        raise _invalid_archive(source, "central directory entry count is inconsistent")
    return actual_entries, directory_start, eocd_offset


def _validate_local_headers(
    file: BinaryIO,
    source: Path,
    infos: list[zipfile.ZipInfo],
    *,
    directory_start: int,
) -> None:
    for info in infos:
        offset = info.header_offset
        if offset < 0 or offset + _LOCAL_FILE_HEADER.size > directory_start:
            raise _invalid_archive(source, "local file header points outside the archive payload area")
        header = _read_archive_at(file, offset, _LOCAL_FILE_HEADER.size, source)
        try:
            (
                signature,
                _,
                local_flags,
                local_method,
                _,
                _,
                _,
                _,
                _,
                filename_size,
                extra_size,
            ) = _LOCAL_FILE_HEADER.unpack(header)
        except struct.error as error:
            raise _invalid_archive(source, "local file header is malformed") from error
        if signature != _LOCAL_FILE_HEADER_SIGNATURE:
            raise _invalid_archive(source, "local file header signature is invalid")
        local_header_end = offset + _LOCAL_FILE_HEADER.size + filename_size + extra_size
        if local_header_end > directory_start:
            raise _invalid_archive(source, "local file header exceeds the archive payload area")

        raw_filename = _read_archive_at(file, offset + _LOCAL_FILE_HEADER.size, filename_size, source)
        encoding = "utf-8" if local_flags & 0x800 else "cp437"
        try:
            local_filename = raw_filename.decode(encoding)
        except UnicodeDecodeError as error:
            raise OctxSecurityError("ZIP local path has invalid encoding", path=info.orig_filename) from error
        local_candidate = local_filename[:-1] if local_filename.endswith("/") else local_filename
        logical_path(local_candidate)

        if local_flags != info.flag_bits:
            raise OctxSecurityError("ZIP local and central flags do not match", path=info.orig_filename)
        if local_method != info.compress_type:
            raise OctxSecurityError("ZIP local and central compression methods do not match", path=info.orig_filename)
        central_encoding = "utf-8" if info.flag_bits & 0x800 else "cp437"
        try:
            central_filename = info.orig_filename.encode(central_encoding)
        except UnicodeEncodeError as error:
            raise OctxSecurityError("ZIP central path has invalid encoding", path=info.orig_filename) from error
        if raw_filename != central_filename:
            raise OctxSecurityError("ZIP local and central paths do not match", path=info.orig_filename)


def _scan_archive(
    source: Path, limits: ArchiveLimits
) -> tuple[dict[str, zipfile.ZipInfo], tuple[int, ...], BinaryIO, zipfile.ZipFile]:
    try:
        descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as error:
        raise _invalid_archive(source, str(error)) from error
    try:
        metadata = os.fstat(descriptor)
    except OSError as error:
        os.close(descriptor)
        raise _invalid_archive(source, str(error)) from error
    if not stat.S_ISREG(metadata.st_mode):
        os.close(descriptor)
        raise OctxSecurityError("OCTX archive source must remain a regular file", path=str(source))
    signature = _file_signature(metadata)
    try:
        file = os.fdopen(descriptor, "rb")
    except BaseException:
        os.close(descriptor)
        raise
    archive: zipfile.ZipFile | None = None
    try:
        declared_entries, directory_start, eocd_offset = _preflight_zip(file, source, limits)
        if _file_signature(os.fstat(descriptor)) != signature:
            raise OctxSecurityError("archive changed while it was scanned", path=str(source))
        try:
            archive = zipfile.ZipFile(_ZipCommentlessView(file, eocd_offset))
        except Exception as error:
            if _file_signature(os.fstat(descriptor)) != signature:
                raise OctxSecurityError("archive changed while it was scanned", path=str(source)) from error
            raise _invalid_archive(source, str(error)) from error
        infos = archive.infolist()
        if len(infos) != declared_entries:
            raise _invalid_archive(source, "central directory entry count is inconsistent")
        _validate_local_headers(file, source, infos, directory_start=directory_start)
        entries: dict[str, zipfile.ZipInfo] = {}
        seen: set[str] = set()
        total = 0
        for info in infos:
            if info.orig_filename != info.filename:
                raise OctxSecurityError("ZIP path contains a truncated or ambiguous filename", path=info.orig_filename)
            candidate = (
                info.orig_filename[:-1] if info.is_dir() and info.orig_filename.endswith("/") else info.orig_filename
            )
            path = logical_path(candidate)
            if path in seen:
                raise OctxSecurityError("archive contains duplicate logical paths", path=path)
            seen.add(path)
            if any(ord(character) > 127 for character in info.filename) and not info.flag_bits & 0x800:
                raise OctxSecurityError("non-ASCII ZIP path is not marked as UTF-8", path=path)
            if info.flag_bits & 0x1:
                raise OctxSecurityError("encrypted ZIP entries are not supported", path=path)
            if info.compress_type not in _SUPPORTED_COMPRESSION:
                raise OctxSecurityError("unsupported ZIP compression method", path=path)
            if info.create_system == 3:
                mode = (info.external_attr >> 16) & 0xFFFF
                file_type = stat.S_IFMT(mode)
                allowed_type = stat.S_IFDIR if info.is_dir() else stat.S_IFREG
                if file_type not in {0, allowed_type}:
                    raise OctxSecurityError("ZIP entry is not a regular file", path=path)
            if info.is_dir():
                continue
            if info.file_size > limits.max_file_size:
                raise OctxResourceLimitError("archive file exceeds configured size limit", path=path)
            total += info.file_size
            if total > limits.max_total_uncompressed:
                raise OctxResourceLimitError("archive exceeds total uncompressed size limit", path=str(source))
            ratio = (
                float("inf")
                if info.compress_size == 0 and info.file_size
                else info.file_size / max(info.compress_size, 1)
            )
            if ratio > limits.max_compression_ratio:
                raise OctxResourceLimitError("archive entry exceeds compression ratio limit", path=path)
            entries[path] = info
        if _file_signature(os.fstat(descriptor)) != signature:
            raise OctxSecurityError("archive changed while it was scanned", path=str(source))
        if _file_signature(_safe_lstat(source)) != signature:
            raise OctxSecurityError("archive changed while it was scanned", path=str(source))
        return entries, signature, file, archive
    except BaseException:
        if archive is not None:
            try:
                archive.close()
            except OSError:
                pass
        file.close()
        raise


def _scan_directory(
    source: Path, limits: ArchiveLimits
) -> tuple[dict[str, tuple[Path, tuple[int, ...]]], tuple[int, ...]]:
    root_metadata = _safe_lstat(source)
    if not stat.S_ISDIR(root_metadata.st_mode) or stat.S_ISLNK(root_metadata.st_mode):
        raise OctxSecurityError("working directory source must be a real directory", path=str(source))
    entries: dict[str, tuple[Path, tuple[int, ...]]] = {}
    total = 0
    count = 0

    def walk_error(error: OSError) -> None:
        raise OctxSecurityError("working directory cannot be scanned safely", path=error.filename) from error

    for root, directories, files in os.walk(source, topdown=True, onerror=walk_error, followlinks=False):
        root_path = Path(root)
        for directory in list(directories):
            candidate = root_path / directory
            metadata = _safe_lstat(candidate)
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise OctxSecurityError("working directory contains a linked or special directory", path=str(candidate))
            logical_path(candidate.relative_to(source).as_posix())
            count += 1
            if count > limits.max_entries:
                raise OctxResourceLimitError("working directory entry count exceeds configured limit", path=str(source))
        for filename in files:
            candidate = root_path / filename
            metadata = _safe_lstat(candidate)
            path = logical_path(candidate.relative_to(source).as_posix())
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise OctxSecurityError("working directory contains a linked or special file", path=path)
            count += 1
            if count > limits.max_entries:
                raise OctxResourceLimitError("working directory entry count exceeds configured limit", path=str(source))
            if metadata.st_size > limits.max_file_size:
                raise OctxResourceLimitError("working directory file exceeds configured size limit", path=path)
            total += metadata.st_size
            if total > limits.max_total_uncompressed:
                raise OctxResourceLimitError("working directory exceeds total size limit", path=str(source))
            if path in entries:
                raise OctxSecurityError("working directory contains duplicate logical paths", path=path)
            entries[path] = (candidate, _file_signature(metadata))
    if _directory_signature(_safe_lstat(source)) != _directory_signature(root_metadata):
        raise OctxSecurityError("working directory changed while it was opened", path=str(source))
    return entries, _directory_signature(root_metadata)


def open_octx(source: os.PathLike[str] | str, *, limits: ArchiveLimits | None = None) -> OctxPackage:
    path = Path(source).expanduser().absolute()
    selected_limits = limits or ArchiveLimits()
    try:
        source_metadata = path.lstat()
    except FileNotFoundError:
        raise FileNotFoundError(path) from None
    except OSError as error:
        raise OctxSecurityError("OCTX source cannot be inspected safely", path=str(path)) from error
    if stat.S_ISLNK(source_metadata.st_mode):
        raise OctxSecurityError("OCTX source must not be a symbolic link", path=str(path))
    if stat.S_ISDIR(source_metadata.st_mode):
        entries, signature = _scan_directory(path, selected_limits)
        if "manifest.json" not in entries:
            raise OctxFormatError("working directory is missing manifest.json", path="manifest.json")
        package = OctxPackage(
            path,
            limits=selected_limits,
            kind="directory",
            entries=entries,
            manifest={},
            source_signature=signature,
        )
        manifest = _parse_manifest(package._read_any("manifest.json"), selected_limits)
        package._set_manifest(manifest)
        return package
    if not stat.S_ISREG(source_metadata.st_mode):
        raise OctxSecurityError("OCTX archive source must be a regular file", path=str(path))
    entries, signature, archive_file, archive = _scan_archive(path, selected_limits)
    try:
        package = OctxPackage(
            path,
            limits=selected_limits,
            kind="zip",
            entries=entries,
            manifest={},
            source_signature=signature,
            archive_file=archive_file,
            archive=archive,
        )
    except BaseException:
        try:
            archive.close()
        finally:
            archive_file.close()
        raise
    try:
        if "manifest.json" not in entries:
            raise OctxFormatError("archive is missing manifest.json", path="manifest.json")
        manifest = _parse_manifest(package._read_any("manifest.json"), selected_limits)
        package._set_manifest(manifest)
        return package
    except BaseException:
        package.close()
        raise
