from __future__ import annotations

import builtins
import json
import struct
from pathlib import Path

import pyarrow as pa
import pyarrow.ipc as ipc
import pytest
from conftest import (
    CHUNK_2_ID,
    CHUNK_ID,
    DOC_ID,
    ENTITY_ID,
    EVENT_ID,
    concept_markdown,
    mutate_and_rehash,
    repack,
    write_jsonl,
)

from octx import ArchiveLimits, create_octx, open_octx, validate_octx
from octx.errors import OctxResourceLimitError, OctxValidationError


def _arrow_bytes(
    record_ids: list[str],
    values: list[float | None],
    *,
    value_type=None,  # type: ignore[no-untyped-def]
    stream: bool = False,
    compression: str | None = None,
) -> bytes:
    value_type = value_type or pa.float32()
    dimension = len(values) // len(record_ids)
    vector_type = pa.list_(value_type, dimension)
    schema = pa.schema(
        [
            pa.field("record_id", pa.string(), nullable=False),
            pa.field("vector", vector_type, nullable=False),
        ]
    )
    table = pa.Table.from_arrays(
        [
            pa.array(record_ids, type=pa.string()),
            pa.FixedSizeListArray.from_arrays(pa.array(values, type=value_type), dimension),
        ],
        schema=schema,
    )
    sink = pa.BufferOutputStream()
    factory = ipc.new_stream if stream else ipc.new_file
    options = ipc.IpcWriteOptions(compression=compression)
    with factory(sink, schema, options=options) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()


def _arrow_bytes_with_dictionary_column(*, compression: str | None = None) -> bytes:
    vector_type = pa.list_(pa.float32(), 3)
    labels = pa.array(["context"]).dictionary_encode()
    schema = pa.schema(
        [
            pa.field("record_id", pa.string(), nullable=False),
            pa.field("vector", vector_type, nullable=False),
            pa.field("label", labels.type, nullable=False),
        ]
    )
    batch = pa.RecordBatch.from_arrays(
        [
            pa.array([CHUNK_ID]),
            pa.FixedSizeListArray.from_arrays(pa.array([0.1, 0.2, 0.3], type=pa.float32()), 3),
            labels,
        ],
        schema=schema,
    )
    sink = pa.BufferOutputStream()
    options = ipc.IpcWriteOptions(compression=compression)
    with ipc.new_file(sink, schema, options=options) as writer:
        writer.write_batch(batch)
    return sink.getvalue().to_pybytes()


def _append_unindexed_record_batch(payload: bytes) -> bytes:
    footer_size = struct.unpack_from("<i", payload, len(payload) - 10)[0]
    footer_start = len(payload) - 10 - footer_size
    reader = pa.BufferReader(payload)
    reader.seek(8)
    record_batch = None
    end_of_stream = None
    while reader.tell() < footer_start:
        start = reader.tell()
        try:
            message = ipc.read_message(reader)
        except EOFError:
            end_of_stream = start
            break
        if message.type == "record batch":
            record_batch = payload[start : reader.tell()]
    assert record_batch is not None
    assert end_of_stream is not None
    return payload[:end_of_stream] + record_batch + payload[end_of_stream:]


def _valid_vector_package(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text(concept_markdown(), encoding="utf-8")
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=source, name="Vectors", output=tmp_path / "core.octx")
    write_jsonl(
        workspace / "data/chunks.jsonl",
        [{"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": 0, "text": "context"}],
    )
    write_jsonl(
        workspace / "data/events.jsonl",
        [{"id": EVENT_ID, "title": "Created", "content": "OCTX was created."}],
    )
    write_jsonl(workspace / "data/entities.jsonl", [{"id": ENTITY_ID, "name": "OCTX", "type": "format"}])
    write_jsonl(workspace / "relations/chunk-events.jsonl", [{"chunk_id": CHUNK_ID, "event_id": EVENT_ID}])
    write_jsonl(workspace / "relations/event-entities.jsonl", [{"event_id": EVENT_ID, "entity_id": ENTITY_ID}])
    vectors = workspace / "vectors"
    vectors.mkdir()
    (vectors / "config.json").write_text('{"model":"test/embedding"}\n', encoding="utf-8")
    (vectors / "chunks.arrow").write_bytes(_arrow_bytes([CHUNK_ID], [0.1, 0.2, 0.3]))
    return create_octx(
        workspace,
        version="1.1.0",
        output=tmp_path / "vectors.octx",
        capabilities={"chunks": "1.0", "events": "1.0", "entities": "1.0", "vectors": "1.0"},
        profiles={"sag-structured": "1.0"},
    ).output


def test_vector_target_must_exactly_cover_all_target_records(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    chunks = [
        {"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": 0, "text": "one"},
        {"id": CHUNK_2_ID, "document_id": DOC_ID, "ordinal": 1, "text": "two"},
    ]
    relations = [
        {"chunk_id": CHUNK_ID, "event_id": EVENT_ID},
        {"chunk_id": CHUNK_2_ID, "event_id": EVENT_ID},
    ]
    invalid = mutate_and_rehash(
        package,
        tmp_path / "partial-vectors.octx",
        {
            "data/chunks.jsonl": "".join(json.dumps(row) + "\n" for row in chunks).encode(),
            "relations/chunk-events.jsonl": "".join(json.dumps(row) + "\n" for row in relations).encode(),
        },
    )
    report = validate_octx(invalid)
    assert report.capabilities["chunks"].valid
    assert report.profiles["sag-structured"].valid
    assert not report.capabilities["vectors"].valid
    assert "OCTX_VECTOR_COVERAGE" in report.issue_codes


def test_vector_payload_requires_arrow_file_not_stream_format(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    invalid = mutate_and_rehash(
        package,
        tmp_path / "stream.octx",
        {"vectors/chunks.arrow": _arrow_bytes([CHUNK_ID], [0.1, 0.2], stream=True)},
    )
    report = validate_octx(invalid)
    assert not report.capabilities["vectors"].valid
    assert "OCTX_VECTOR_ARROW_INVALID" in report.issue_codes


def test_vector_payload_requires_float32_and_finite_non_null_values(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    wrong_type = mutate_and_rehash(
        package,
        tmp_path / "float64.octx",
        {"vectors/chunks.arrow": _arrow_bytes([CHUNK_ID], [0.1, 0.2], value_type=pa.float64())},
    )
    type_report = validate_octx(wrong_type)
    assert not type_report.capabilities["vectors"].valid
    assert "OCTX_VECTOR_VALUE_SCHEMA" in type_report.issue_codes

    null_value = mutate_and_rehash(
        package,
        tmp_path / "null.octx",
        {"vectors/chunks.arrow": _arrow_bytes([CHUNK_ID], [0.1, None, 0.3])},
    )
    null_report = validate_octx(null_value)
    assert not null_report.capabilities["vectors"].valid
    assert "OCTX_VECTOR_VALUE_INVALID" in null_report.issue_codes


def test_vectors_capability_requires_at_least_one_arrow_target(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["files"] = [entry for entry in manifest["files"] if entry["path"] != "vectors/chunks.arrow"]

    invalid = repack(
        package,
        tmp_path / "no-target.octx",
        replacements={"vectors/chunks.arrow": None},
        mutate_manifest=mutate,
    )
    report = validate_octx(invalid)
    assert not report.capabilities["vectors"].valid
    assert "OCTX_VECTOR_TARGET_REQUIRED" in report.issue_codes


def test_vector_config_revision_must_be_non_empty(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    invalid = mutate_and_rehash(
        package,
        tmp_path / "empty-revision.octx",
        {"vectors/config.json": b'{"model":"test/embedding","revision":""}\n'},
    )
    report = validate_octx(invalid)
    assert not report.capabilities["vectors"].valid
    assert "OCTX_SCHEMA_VALIDATION" in report.issue_codes


@pytest.mark.parametrize(
    "field",
    [
        "apiKey",
        "access_token",
        "authorization",
        "service_url",
        "host",
        "distance_metric",
        "normalization",
    ],
)
def test_vector_config_rejects_connection_secret_and_retrieval_settings(tmp_path: Path, field: str) -> None:
    package = _valid_vector_package(tmp_path)
    invalid = mutate_and_rehash(
        package,
        tmp_path / f"config-{field}.octx",
        {"vectors/config.json": (json.dumps({"model": "test/embedding", field: "local-only"}) + "\n").encode()},
    )

    report = validate_octx(invalid)

    assert report.core.valid
    assert report.capabilities["vectors"].valid is False
    assert "OCTX_VECTOR_CONFIG_FORBIDDEN" in report.issue_codes or "OCTX_SCHEMA_VALIDATION" in report.issue_codes


def test_vectors_require_a_valid_target_capability(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    chunk = {"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": -1, "text": "invalid"}
    invalid = mutate_and_rehash(
        package,
        tmp_path / "invalid-vector-target.octx",
        {"data/chunks.jsonl": (json.dumps(chunk) + "\n").encode()},
    )

    report = validate_octx(invalid)

    assert report.capabilities["chunks"].valid is False
    assert report.capabilities["vectors"].valid is False
    assert "OCTX_VECTOR_TARGET_DEPENDENCY" in report.issue_codes


def test_duplicate_arrow_column_names_return_an_invalid_report(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    schema = pa.schema(
        [
            pa.field("record_id", pa.string(), nullable=False),
            pa.field("record_id", pa.string(), nullable=False),
            pa.field("vector", pa.list_(pa.float32(), 2), nullable=False),
        ]
    )
    batch = pa.RecordBatch.from_arrays(
        [
            pa.array([CHUNK_ID]),
            pa.array([CHUNK_ID]),
            pa.FixedSizeListArray.from_arrays(pa.array([0.1, 0.2], type=pa.float32()), 2),
        ],
        schema=schema,
    )
    sink = pa.BufferOutputStream()
    with ipc.new_file(sink, schema) as writer:
        writer.write_batch(batch)
    invalid = mutate_and_rehash(
        package,
        tmp_path / "duplicate-columns.octx",
        {"vectors/chunks.arrow": sink.getvalue().to_pybytes()},
    )

    report = validate_octx(invalid)

    assert report.capabilities["vectors"].valid is False
    assert "OCTX_VECTOR_COLUMNS_REQUIRED" in report.issue_codes


def test_dictionary_encoded_additional_arrow_column_is_valid(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    with_dictionary = mutate_and_rehash(
        package,
        tmp_path / "dictionary-column.octx",
        {"vectors/chunks.arrow": _arrow_bytes_with_dictionary_column()},
    )

    report = validate_octx(with_dictionary)

    assert report.capabilities["vectors"].valid
    assert report.fully_validated


def test_dictionary_batches_count_toward_arrow_batch_limit(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    with_dictionary = mutate_and_rehash(
        package,
        tmp_path / "dictionary-batch-limit.octx",
        {"vectors/chunks.arrow": _arrow_bytes_with_dictionary_column()},
    )

    with open_octx(with_dictionary, limits=ArchiveLimits(max_arrow_batches=1)) as opened:
        with pytest.raises(OctxResourceLimitError, match="batch count"):
            list(opened.iter_vector_batches("chunks"))


def test_physical_record_batch_count_must_match_arrow_footer(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    extra_record_batch = mutate_and_rehash(
        package,
        tmp_path / "extra-record-batch.octx",
        {
            "vectors/chunks.arrow": _append_unindexed_record_batch(
                _arrow_bytes([CHUNK_ID], [0.1, 0.2, 0.3])
            )
        },
    )

    report = validate_octx(extra_record_batch)

    assert report.capabilities["vectors"].valid is False
    assert "OCTX_VECTOR_ARROW_INVALID" in report.issue_codes


@pytest.mark.parametrize("compression", ["lz4", "zstd"])
def test_arrow_body_compression_is_rejected_before_batch_decode(tmp_path: Path, compression: str) -> None:
    package = _valid_vector_package(tmp_path)
    compressed = mutate_and_rehash(
        package,
        tmp_path / f"compressed-{compression}.octx",
        {"vectors/chunks.arrow": _arrow_bytes([CHUNK_ID], [0.1, 0.2], compression=compression)},
    )

    report = validate_octx(compressed)

    assert report.capabilities["vectors"].valid is False
    assert "OCTX_VECTOR_COMPRESSION_UNSUPPORTED" in report.issue_codes


def test_dictionary_batch_body_compression_is_rejected(tmp_path: Path) -> None:
    package = _valid_vector_package(tmp_path)
    compressed = mutate_and_rehash(
        package,
        tmp_path / "compressed-dictionary.octx",
        {"vectors/chunks.arrow": _arrow_bytes_with_dictionary_column(compression="lz4")},
    )

    report = validate_octx(compressed)

    assert report.capabilities["vectors"].valid is False
    assert "OCTX_VECTOR_COMPRESSION_UNSUPPORTED" in report.issue_codes


def test_vector_reader_streams_record_batches(tmp_path: Path) -> None:
    package = open_octx(_valid_vector_package(tmp_path))
    batches = list(package.iter_vector_batches("chunks"))
    assert len(batches) == 1
    assert batches[0].column("record_id").to_pylist() == [CHUNK_ID]


def test_missing_vector_extra_reports_incomplete_validation(monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    package = _valid_vector_package(tmp_path)
    real_import = builtins.__import__

    def without_pyarrow(name, *args, **kwargs):  # type: ignore[no-untyped-def]
        if name == "pyarrow" or name.startswith("pyarrow."):
            raise ImportError("blocked for test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_pyarrow)
    report = validate_octx(package)

    assert report.valid
    assert not report.fully_validated
    assert report.capabilities["vectors"].valid is None
    assert "OCTX_VECTOR_SUPPORT_UNAVAILABLE" in report.issue_codes


def test_create_requires_complete_vector_validation(monkeypatch, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    _valid_vector_package(tmp_path)
    real_import = builtins.__import__

    def without_pyarrow(name, *args, **kwargs):  # type: ignore[no-untyped-def]
        if name == "pyarrow" or name.startswith("pyarrow."):
            raise ImportError("blocked for test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", without_pyarrow)
    with pytest.raises(OctxValidationError):
        create_octx(tmp_path / "workspace", version="1.2.0", output=tmp_path / "unvalidated.octx")
