from __future__ import annotations

import importlib
import json
import zipfile
from pathlib import Path

import pytest
from conftest import CHUNK_2_ID, CHUNK_ID, DOC_ID, ENTITY_ID, EVENT_ID, concept_markdown, repack, write_jsonl

from octx import ArchiveLimits, create_octx, open_octx, unpack_octx, validate_octx
from octx.errors import OctxIntegrityError, OctxResourceLimitError, OctxSecurityError, OutputExistsError

CAPABILITIES = {"sag-structured": "0.1"}


def _base_package(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text(concept_markdown(), encoding="utf-8")
    return create_octx(
        tmp_path / "workspace",
        source=source,
        name="Boundary Guide",
        output=tmp_path / "base.octx",
    ).output


def _structured_workspace(tmp_path: Path) -> Path:
    _base_package(tmp_path)
    workspace = tmp_path / "workspace"
    write_jsonl(
        workspace / "data/chunks.jsonl",
        [{"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": 0, "text": "Portable context."}],
    )
    write_jsonl(
        workspace / "data/events.jsonl",
        [{"id": EVENT_ID, "title": "Created", "content": "OCTX was created."}],
    )
    write_jsonl(workspace / "data/entities.jsonl", [{"id": ENTITY_ID, "name": "OCTX", "type": "format"}])
    write_jsonl(workspace / "relations/chunk-events.jsonl", [{"chunk_id": CHUNK_ID, "event_id": EVENT_ID}])
    write_jsonl(
        workspace / "relations/event-entities.jsonl",
        [{"event_id": EVENT_ID, "entity_id": ENTITY_ID}],
    )
    return workspace


def _structured_package(tmp_path: Path) -> Path:
    return create_octx(
        _structured_workspace(tmp_path),
        version="1.1.0",
        output=tmp_path / "structured.octx",
        capabilities=CAPABILITIES,
    ).output


def test_unrecognized_capability_versions_are_not_interpreted(tmp_path: Path) -> None:
    package = _structured_package(tmp_path)

    def use_next_minor(manifest: dict) -> None:
        for declaration in manifest["capabilities"].values():
            declaration["version"] = "0.2"

    unsupported = repack(package, tmp_path / "unsupported-declarations.octx", mutate_manifest=use_next_minor)
    report = validate_octx(unsupported)

    assert report.format.valid
    assert all(layer.valid is None for layer in report.capabilities.values())
    assert report.valid
    assert not report.fully_validated


@pytest.mark.parametrize(
    ("name", "declaration", "issue_code"),
    [
        ("sag-structured", {"version": "1"}, "OCTX_CAPABILITY_DECLARATION_INVALID"),
        ("sag-structured", {"version": "00.1"}, "OCTX_CAPABILITY_DECLARATION_INVALID"),
        ("vectors", {"version": 1}, "OCTX_CAPABILITY_DECLARATION_INVALID"),
    ],
)
def test_invalid_declaration_schema_only_invalidates_its_layer(
    tmp_path: Path,
    name: str,
    declaration: dict,
    issue_code: str,
) -> None:
    package = _structured_package(tmp_path)

    def break_declaration(manifest: dict) -> None:
        manifest["capabilities"][name] = declaration

    invalid = repack(package, tmp_path / f"invalid-{name}.octx", mutate_manifest=break_declaration)
    report = validate_octx(invalid)
    layer = report.capabilities[name]

    assert report.format.valid
    assert layer.valid is False
    assert issue_code in {issue.code for issue in layer.issues}
    assert "OCTX_SCHEMA_VALIDATION" in {issue.code for issue in layer.issues}


def test_sag_structured_requires_all_structure_files(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def declare_partial_structure(manifest: dict) -> None:
        manifest["capabilities"] = {"sag-structured": {"version": "0.1"}}
        manifest["files"].extend(
            [
                {"path": "data/events.jsonl", "sha256": "0" * 64},
                {"path": "relations/chunk-events.jsonl", "sha256": "0" * 64},
            ]
        )

    invalid = repack(
        package,
        tmp_path / "events-without-chunks.octx",
        replacements={"data/events.jsonl": b"", "relations/chunk-events.jsonl": b""},
        mutate_manifest=declare_partial_structure,
    )
    report = validate_octx(invalid)

    assert report.format.valid
    assert report.capabilities["sag-structured"].valid is False
    assert "OCTX_CAPABILITY_FILE_REQUIRED" in {
        issue.code for issue in report.capabilities["sag-structured"].issues
    }


def test_manifest_file_count_cannot_exceed_entry_limit(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def add_manifest_only_entry(manifest: dict) -> None:
        manifest["files"].append(
            {
                "path": "extensions/com.example.boundary/1.0/missing.bin",
                "sha256": "0" * 64,
            }
        )

    oversized = repack(package, tmp_path / "too-many-listed-files.octx", mutate_manifest=add_manifest_only_entry)
    limits = ArchiveLimits(max_entries=2)

    with pytest.raises(OctxResourceLimitError):
        open_octx(oversized, limits=limits)
    report = validate_octx(oversized, limits=limits)
    assert not report.valid
    assert "OCTX_RESOURCE_LIMIT" in report.issue_codes


def test_jsonl_record_limit_invalidates_only_the_affected_capability(tmp_path: Path) -> None:
    package = _structured_package(tmp_path)
    chunks = [
        {"id": CHUNK_ID, "document_id": DOC_ID, "ordinal": 0, "text": "One"},
        {"id": CHUNK_2_ID, "document_id": DOC_ID, "ordinal": 1, "text": "Two"},
    ]
    limited = repack(
        package,
        tmp_path / "too-many-chunks.octx",
        replacements={"data/chunks.jsonl": "".join(json.dumps(row) + "\n" for row in chunks).encode()},
    )

    report = validate_octx(limited, limits=ArchiveLimits(max_jsonl_records=1))

    assert report.format.valid
    assert report.capabilities["sag-structured"].valid is False
    assert "OCTX_RESOURCE_LIMIT" in {issue.code for issue in report.capabilities["sag-structured"].issues}


def _deep_event_id(index: int) -> str:
    return f"019c{index:04x}-0000-7000-8000-{index:012x}"


def test_deep_event_parent_chain_is_validated_without_recursion(tmp_path: Path) -> None:
    package = _structured_package(tmp_path)
    count = 1_100
    events = []
    chunk_events = []
    event_entities = []
    for index in range(count):
        identifier = _deep_event_id(index)
        event = {"id": identifier, "title": f"Event {index}", "content": f"Content {index}"}
        if index:
            event.update({"parent_id": _deep_event_id(index - 1), "level": index})
        events.append(event)
        chunk_events.append({"chunk_id": CHUNK_ID, "event_id": identifier})
        event_entities.append({"event_id": identifier, "entity_id": ENTITY_ID})

    deep = repack(
        package,
        tmp_path / "deep-events.octx",
        replacements={
            "data/events.jsonl": "".join(json.dumps(row) + "\n" for row in events).encode(),
            "relations/chunk-events.jsonl": "".join(json.dumps(row) + "\n" for row in chunk_events).encode(),
            "relations/event-entities.jsonl": "".join(json.dumps(row) + "\n" for row in event_entities).encode(),
        },
    )

    report = validate_octx(deep)

    assert report.valid
    assert "OCTX_EVENT_HIERARCHY_CYCLE" not in report.issue_codes


def test_unpack_rejects_symlink_ancestor_without_writing_to_victim(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    victim = tmp_path / "victim"
    victim.mkdir()
    sentinel = victim / "sentinel.txt"
    sentinel.write_text("unchanged", encoding="utf-8")
    linked_parent = tmp_path / "linked-parent"
    linked_parent.symlink_to(victim, target_is_directory=True)

    with pytest.raises(FileExistsError):
        unpack_octx(package, linked_parent / "unpacked")

    assert sentinel.read_text(encoding="utf-8") == "unchanged"
    assert not (victim / "unpacked").exists()


def test_unpack_source_change_after_validation_leaves_no_destination(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _base_package(tmp_path)
    workspace = tmp_path / "workspace"
    document = workspace / "knowledge/guide.md"
    destination = tmp_path / "unpacked"
    unpack_module = importlib.import_module("octx.unpack")
    real_validate = unpack_module.validate_octx

    def validate_then_mutate(package, **kwargs):  # type: ignore[no-untyped-def]
        report = real_validate(package, **kwargs)
        document.write_bytes(document.read_bytes() + b"\nchanged after validation\n")
        return report

    monkeypatch.setattr(unpack_module, "validate_octx", validate_then_mutate)

    with pytest.raises((OctxIntegrityError, OctxSecurityError)):
        unpack_octx(workspace, destination)

    assert not destination.exists()
    assert not list(tmp_path.glob(f".{destination.name}.*.tmp"))


def _empty_arrow_file(*, write_empty_batch: bool) -> bytes:
    pa = pytest.importorskip("pyarrow")
    ipc = pytest.importorskip("pyarrow.ipc")
    schema = pa.schema(
        [
            pa.field("record_id", pa.string(), nullable=False),
            pa.field("vector", pa.list_(pa.float32(), 3), nullable=False),
        ]
    )
    sink = pa.BufferOutputStream()
    with ipc.new_file(sink, schema) as writer:
        if write_empty_batch:
            writer.write_batch(
                pa.RecordBatch.from_arrays(
                    [
                        pa.array([], type=pa.string()),
                        pa.array([], type=pa.list_(pa.float32(), 3)),
                    ],
                    schema=schema,
                )
            )
    return sink.getvalue().to_pybytes()


@pytest.mark.parametrize("write_empty_batch", [False, True])
def test_empty_vector_file_can_be_read_as_an_empty_table(tmp_path: Path, write_empty_batch: bool) -> None:
    package = _structured_package(tmp_path)

    def declare_vectors(manifest: dict) -> None:
        manifest["capabilities"]["vectors"] = {"version": "0.1"}
        manifest["files"].extend(
            [
                {"path": "vectors/config.json", "sha256": "0" * 64},
                {"path": "vectors/chunks.arrow", "sha256": "0" * 64},
            ]
        )

    vector_package = repack(
        package,
        tmp_path / f"empty-vectors-{write_empty_batch}.octx",
        replacements={
            "vectors/config.json": b'{"model":"test/embedding"}\n',
            "vectors/chunks.arrow": _empty_arrow_file(write_empty_batch=write_empty_batch),
        },
        mutate_manifest=declare_vectors,
    )

    with open_octx(vector_package) as opened:
        table = opened.read_vector_table("chunks")
    report = validate_octx(vector_package)

    assert table.num_rows == 0
    assert table.schema.names == ["record_id", "vector"]
    assert report.format.valid
    assert report.capabilities["vectors"].valid is False
    assert "OCTX_VECTOR_COVERAGE" in report.issue_codes


def test_malformed_existing_output_shape_raises_domain_error(tmp_path: Path) -> None:
    output = tmp_path / "malformed.octx"
    malformed_manifest = {
        "format": "octx",
        "format_version": "0.1",
        "asset": "not-an-object",
        "release": ["not-an-object"],
        "files": [],
    }
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(malformed_manifest))
    before = output.read_bytes()
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# Guide\n", encoding="utf-8")

    with pytest.raises(OutputExistsError):
        create_octx(
            tmp_path / "new-workspace",
            source=source,
            name="Guide",
            output=output,
        )

    assert output.read_bytes() == before


def test_unpack_closes_only_the_package_it_opens(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    package_path = _base_package(tmp_path)
    unpack_module = importlib.import_module("octx.unpack")
    real_open = unpack_module.open_octx
    opened = []

    def track_open(*args, **kwargs):  # type: ignore[no-untyped-def]
        package = real_open(*args, **kwargs)
        opened.append(package)
        return package

    monkeypatch.setattr(unpack_module, "open_octx", track_open)
    unpack_octx(package_path, tmp_path / "from-path")
    assert len(opened) == 1
    assert opened[0]._closed

    with open_octx(package_path) as caller_package:
        unpack_octx(caller_package, tmp_path / "from-package")
        assert caller_package.read_payload("knowledge/guide.md")
