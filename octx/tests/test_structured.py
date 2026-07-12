from __future__ import annotations

import json
import zipfile
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

from octx import create_octx, open_octx, validate_octx
from octx.errors import OctxValidationError

CAPABILITIES = {"sag-structured": "0.1"}


def _workspace(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text(concept_markdown(), encoding="utf-8")
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=source, name="Structured Guide", output=tmp_path / "base.octx")
    return workspace


def _write_structure(workspace: Path, *, chunks: list[dict] | None = None, events: list[dict] | None = None) -> None:
    chunks = chunks or [{"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": 0, "text": "Portable context."}]
    events = events or [{"id": EVENT_ID, "title": "OCTX created", "content": "OCTX packages portable context."}]
    write_jsonl(workspace / "data/chunks.jsonl", chunks)
    write_jsonl(workspace / "data/events.jsonl", events)
    write_jsonl(workspace / "data/entities.jsonl", [{"id": ENTITY_ID, "name": "OCTX", "type": "format"}])
    write_jsonl(workspace / "relations/chunk-events.jsonl", [{"chunk_id": CHUNK_ID, "event_id": EVENT_ID}])
    write_jsonl(workspace / "relations/event-entities.jsonl", [{"event_id": EVENT_ID, "entity_id": ENTITY_ID}])


def _valid_structured_package(tmp_path: Path) -> Path:
    workspace = _workspace(tmp_path)
    _write_structure(workspace)
    return create_octx(
        workspace,
        version="1.1.0",
        output=tmp_path / "structured.octx",
        capabilities=CAPABILITIES,
    ).output


def test_valid_sag_structured_capability_and_typed_iterators(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    _write_structure(workspace)
    result = create_octx(
        workspace,
        version="1.1.0",
        output=tmp_path / "structured.octx",
        capabilities=CAPABILITIES,
    )

    assert result.report.valid
    assert result.report.capabilities["sag-structured"].valid
    package = open_octx(result.output)
    assert package.manifest["capabilities"] == {"sag-structured": {"version": "0.1"}}
    assert "profiles" not in package.manifest
    assert [record["id"] for record in package.iter_chunks()] == [CHUNK_ID]
    assert [record["id"] for record in package.iter_events()] == [EVENT_ID]
    assert [record["id"] for record in package.iter_entities()] == [ENTITY_ID]
    assert list(package.iter_chunk_events()) == [{"chunk_id": CHUNK_ID, "event_id": EVENT_ID}]
    assert list(package.iter_event_entities()) == [{"event_id": EVENT_ID, "entity_id": ENTITY_ID}]


def test_sag_structured_rejects_an_orphan_chunk_without_invalidating_format(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    chunks = [
        {"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": 0, "text": "One"},
        {"id": CHUNK_2_ID, "document_id": DOC_ID, "ordinal": 1, "text": "Two"},
    ]
    mutated = mutate_and_rehash(
        package,
        tmp_path / "invalid-sag-structured.octx",
        {"data/chunks.jsonl": "".join(json.dumps(row) + "\n" for row in chunks).encode()},
    )

    report = validate_octx(mutated)
    assert report.format.valid
    assert not report.capabilities["sag-structured"].valid
    assert not report.valid
    assert "OCTX_SAG_CHUNK_WITHOUT_EVENT" in report.issue_codes


def test_event_cycles_invalidate_events_and_downstream_layers(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    child = "019c6666-6666-7666-8666-666666666666"
    events = [
        {"id": EVENT_ID, "title": "A", "content": "A", "parent_id": child, "level": 2},
        {"id": child, "title": "B", "content": "B", "parent_id": EVENT_ID, "level": 1},
    ]
    chunk_events = [{"chunk_id": CHUNK_ID, "event_id": EVENT_ID}, {"chunk_id": CHUNK_ID, "event_id": child}]
    event_entities = [{"event_id": EVENT_ID, "entity_id": ENTITY_ID}, {"event_id": child, "entity_id": ENTITY_ID}]
    mutated = mutate_and_rehash(
        package,
        tmp_path / "cycle.octx",
        {
            "data/events.jsonl": "".join(json.dumps(row) + "\n" for row in events).encode(),
            "relations/chunk-events.jsonl": "".join(json.dumps(row) + "\n" for row in chunk_events).encode(),
            "relations/event-entities.jsonl": "".join(json.dumps(row) + "\n" for row in event_entities).encode(),
        },
    )

    report = validate_octx(mutated)
    assert report.format.valid
    assert not report.capabilities["sag-structured"].valid
    assert "OCTX_EVENT_HIERARCHY_CYCLE" in report.issue_codes


def test_vectors_use_arrow_file_schema_and_exact_coverage(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    _write_structure(workspace)
    vectors = workspace / "vectors"
    vectors.mkdir()
    (vectors / "config.json").write_text(json.dumps({"model": "test/embedding"}) + "\n", encoding="utf-8")
    schema = pa.schema(
        [
            pa.field("record_id", pa.string(), nullable=False),
            pa.field("vector", pa.list_(pa.float32(), 3), nullable=False),
        ]
    )
    table = pa.Table.from_arrays(
        [
            pa.array([CHUNK_ID], type=pa.string()),
            pa.FixedSizeListArray.from_arrays(pa.array([0.1, 0.2, 0.3], type=pa.float32()), 3),
        ],
        schema=schema,
    )
    with pa.OSFile(str(vectors / "chunks.arrow"), "wb") as sink, ipc.new_file(sink, schema) as writer:
        writer.write_table(table)

    result = create_octx(
        workspace,
        version="1.1.0",
        output=tmp_path / "vectors.octx",
        capabilities={**CAPABILITIES, "vectors": "0.1"},
    )
    assert result.report.capabilities["vectors"].valid
    vector_table = open_octx(result.output).read_vector_table("chunks")
    assert vector_table.column("record_id").to_pylist() == [CHUNK_ID]


def test_jsonl_duplicate_keys_invalidate_the_capability(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    content = (f'{{"id":"{CHUNK_ID}","id":"{CHUNK_ID}","document_id":"{DOC_ID}","ordinal":0,"text":"x"}}\n').encode()
    mutated = mutate_and_rehash(
        package,
        tmp_path / "duplicate.octx",
        {"data/chunks.jsonl": content},
    )
    report = validate_octx(mutated)
    assert report.format.valid
    assert not report.capabilities["sag-structured"].valid
    assert "OCTX_JSON_DUPLICATE_KEY" in report.issue_codes


def test_invalid_format_blocks_all_structured_payload_parsing(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)

    def invalidate_format(manifest: dict) -> None:
        manifest["asset"]["name"] = ""

    invalid = repack(
        package,
        tmp_path / "invalid-format.octx",
        replacements={"data/chunks.jsonl": b"not-json\n"},
        mutate_manifest=invalidate_format,
    )
    report = validate_octx(invalid)

    assert not report.format.valid
    assert report.capabilities["sag-structured"].valid is False
    assert not report.capabilities["sag-structured"].fully_validated
    assert "OCTX_CAPABILITY_DEPENDENCY_INVALID" in report.issue_codes
    assert "OCTX_JSON_INVALID" not in report.issue_codes


def test_unsupported_format_version_blocks_structured_payload_parsing(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)

    def use_unsupported_version(manifest: dict) -> None:
        manifest["format_version"] = "0.2"

    unsupported = repack(
        package,
        tmp_path / "unsupported-format.octx",
        replacements={"data/chunks.jsonl": b"not-json\n"},
        mutate_manifest=use_unsupported_version,
    )
    report = validate_octx(unsupported)

    assert not report.format.valid
    assert not report.format.fully_validated
    assert report.capabilities["sag-structured"].valid is False
    assert "OCTX_FORMAT_VERSION_UNSUPPORTED" in report.issue_codes
    assert "OCTX_JSON_INVALID" not in report.issue_codes


def test_format_integrity_failure_blocks_structured_payload_parsing(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    with zipfile.ZipFile(package) as archive:
        entries = {info.filename: archive.read(info) for info in archive.infolist()}
    entries["data/chunks.jsonl"] = b"not-json\n"
    tampered = tmp_path / "tampered.octx"
    with zipfile.ZipFile(tampered, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, content in entries.items():
            archive.writestr(path, content)

    report = validate_octx(tampered)

    assert not report.format.valid
    assert report.capabilities["sag-structured"].valid is False
    assert "OCTX_FILE_DIGEST_MISMATCH" in report.issue_codes
    assert "OCTX_JSON_INVALID" not in report.issue_codes


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (b"\n", "OCTX_JSONL_EMPTY_LINE"),
        (
            f'{{"id":"{CHUNK_ID}","document_id":"{DOC_ID}","ordinal":0,"text":NaN}}\n'.encode(),
            "OCTX_JSON_INVALID",
        ),
        (
            b"\xef\xbb\xbf" + f'{{"id":"{CHUNK_ID}","document_id":"{DOC_ID}","ordinal":0,"text":"x"}}\n'.encode(),
            "OCTX_JSON_INVALID",
        ),
    ],
)
def test_jsonl_lexical_errors_invalidate_the_whole_capability(tmp_path: Path, content: bytes, code: str) -> None:
    package = _valid_structured_package(tmp_path)
    invalid = mutate_and_rehash(package, tmp_path / "lexical.octx", {"data/chunks.jsonl": content})
    report = validate_octx(invalid)
    assert report.format.valid
    assert not report.capabilities["sag-structured"].valid
    assert code in report.issue_codes


def test_event_without_a_chunk_source_is_invalid(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    invalid = mutate_and_rehash(
        package,
        tmp_path / "event-without-source.octx",
        {"relations/chunk-events.jsonl": b""},
    )
    report = validate_octx(invalid)
    assert not report.capabilities["sag-structured"].valid
    assert "OCTX_EVENT_WITHOUT_CHUNK" in report.issue_codes


def test_entity_types_are_open_ended(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    entity = {"id": ENTITY_ID, "name": "OCTX", "type": "Unregistered/Custom-Type"}
    changed = mutate_and_rehash(
        package,
        tmp_path / "custom-entity.octx",
        {"data/entities.jsonl": (json.dumps(entity) + "\n").encode()},
    )
    assert validate_octx(changed).valid


def test_event_entity_weight_accepts_an_arbitrarily_large_json_integer(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    _write_structure(workspace)
    write_jsonl(
        workspace / "relations/event-entities.jsonl",
        [{"event_id": EVENT_ID, "entity_id": ENTITY_ID, "weight": 10**400}],
    )

    result = create_octx(
        workspace,
        version="1.1.0",
        output=tmp_path / "large-integer-weight.octx",
        capabilities=CAPABILITIES,
    )

    assert result.report.valid
    assert validate_octx(result.output).valid


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_event_entity_weight_rejects_nonfinite_json_constants(tmp_path: Path, literal: str) -> None:
    package = _valid_structured_package(tmp_path)
    relation = (
        f'{{"event_id":"{EVENT_ID}","entity_id":"{ENTITY_ID}","weight":{literal}}}\n'.encode()
    )
    invalid = mutate_and_rehash(
        package,
        tmp_path / f"nonfinite-weight-{literal}.octx",
        {"relations/event-entities.jsonl": relation},
    )

    report = validate_octx(invalid)

    assert report.format.valid
    assert report.capabilities["sag-structured"].valid is False
    assert "OCTX_JSON_INVALID" in report.issue_codes


@pytest.mark.parametrize("field", ["chunk_id", "references", "rank"])
def test_event_rejects_nonportable_source_and_local_fields(tmp_path: Path, field: str) -> None:
    package = _valid_structured_package(tmp_path)
    event = {
        "id": EVENT_ID,
        "title": "Created",
        "content": "OCTX was created.",
        field: "local-only",
    }
    invalid = mutate_and_rehash(
        package,
        tmp_path / f"event-{field}.octx",
        {"data/events.jsonl": (json.dumps(event) + "\n").encode()},
    )

    report = validate_octx(invalid)

    assert report.format.valid
    assert report.capabilities["sag-structured"].valid is False
    assert "OCTX_SCHEMA_VALIDATION" in report.issue_codes


@pytest.mark.parametrize(
    "field",
    ["normalized_name", "entity_type_id", "index_id", "index_status", "embedding", "vector"],
)
def test_entity_rejects_normalized_database_and_vector_fields(tmp_path: Path, field: str) -> None:
    package = _valid_structured_package(tmp_path)
    entity = {"id": ENTITY_ID, "name": "OCTX", "type": "format", field: "local-only"}
    invalid = mutate_and_rehash(
        package,
        tmp_path / f"entity-{field}.octx",
        {"data/entities.jsonl": (json.dumps(entity) + "\n").encode()},
    )

    report = validate_octx(invalid)

    assert report.format.valid
    assert report.capabilities["sag-structured"].valid is False
    assert "OCTX_SCHEMA_VALIDATION" in report.issue_codes


def test_safe_unknown_record_fields_remain_forward_compatible(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    event = {
        "id": EVENT_ID,
        "title": "Created",
        "content": "OCTX was created.",
        "x-producer-note": {"confidence": "high"},
    }
    compatible = mutate_and_rehash(
        package,
        tmp_path / "event-unknown-field.octx",
        {"data/events.jsonl": (json.dumps(event) + "\n").encode()},
    )

    assert validate_octx(compatible).valid


def test_record_ids_are_unique_across_structured_types(tmp_path: Path) -> None:
    package = _valid_structured_package(tmp_path)
    event = {"id": CHUNK_ID, "title": "Collision", "content": "Collision"}
    chunk_event = {"chunk_id": CHUNK_ID, "event_id": CHUNK_ID}
    event_entity = {"event_id": CHUNK_ID, "entity_id": ENTITY_ID}
    invalid = mutate_and_rehash(
        package,
        tmp_path / "identity-collision.octx",
        {
            "data/events.jsonl": (json.dumps(event) + "\n").encode(),
            "relations/chunk-events.jsonl": (json.dumps(chunk_event) + "\n").encode(),
            "relations/event-entities.jsonl": (json.dumps(event_entity) + "\n").encode(),
        },
    )
    report = validate_octx(invalid)
    assert not report.capabilities["sag-structured"].valid
    assert "OCTX_ID_DUPLICATE" in report.issue_codes


def test_create_never_publishes_invalid_declared_structure_and_can_retry_failed_release(tmp_path: Path) -> None:
    workspace = _workspace(tmp_path)
    _write_structure(
        workspace,
        chunks=[{"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": -1, "text": "invalid"}],
    )
    output = tmp_path / "invalid.octx"
    with pytest.raises(OctxValidationError):
        create_octx(
            workspace,
            version="1.1.0",
            output=output,
            capabilities=CAPABILITIES,
        )
    assert not output.exists()
    state = json.loads((workspace / ".octx/state.json").read_text(encoding="utf-8"))
    assert state["releases"]["1.1.0"]["status"] == "failed"

    write_jsonl(
        workspace / "data/chunks.jsonl",
        [{"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": 0, "text": "valid"}],
    )
    result = create_octx(
        workspace,
        version="1.1.0",
        output=output,
        capabilities=CAPABILITIES,
    )
    assert result.report.valid
    assert result.asset_id == open_octx(tmp_path / "base.octx").manifest["asset"]["id"]
