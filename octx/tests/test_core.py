from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
import yaml
from conftest import concept_markdown

import octx.creation as creation_module
from octx import ArchiveLimits, create_octx, open_octx, unpack_octx, validate_octx
from octx._strict import package_digest
from octx.errors import (
    ConfirmationRequired,
    DerivationRequired,
    OctxFormatError,
    OctxValidationError,
    OutputExistsError,
    ReleaseVersionError,
)
from octx.package import OctxPackage


def test_create_open_validate_core_round_trip(markdown_source: Path, tmp_path: Path) -> None:
    source_before = (markdown_source / "guide.md").read_bytes()
    workspace = tmp_path / "workspace"
    output = tmp_path / "guide-1.0.0.octx"

    result = create_octx(
        workspace=workspace,
        source=markdown_source,
        name="OCTX Guide",
        output=output,
    )

    assert result.status == "ready"
    assert result.version == "1.0.0"
    assert output.is_file()
    assert (markdown_source / "guide.md").read_bytes() == source_before
    assert result.report.valid
    assert result.report.fully_validated

    package = open_octx(output)
    assert package.manifest["asset"]["id"] == result.asset_id
    assert package.manifest["release"]["package_digest"] == result.package_digest
    documents = list(package.iter_documents())
    assert len(documents) == 1
    assert documents[0].path == "knowledge/guide.md"
    assert documents[0].metadata["type"] == "Document"
    assert documents[0].metadata["title"] == "OCTX Guide"
    assert documents[0].metadata["octx"]["document_id"] == result.document_ids["knowledge/guide.md"]
    assert "Portable context." in documents[0].body

    directory_report = validate_octx(workspace)
    archive_report = validate_octx(package)
    assert directory_report.valid
    assert archive_report.to_dict() == result.report.to_dict()


def test_rebuild_is_stable_and_changed_content_requires_higher_version(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    first = create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "one.octx")
    rebuilt = create_octx(workspace, output=tmp_path / "two.octx")

    assert rebuilt.asset_id == first.asset_id
    assert rebuilt.package_digest == first.package_digest
    assert rebuilt.created_at == first.created_at
    assert rebuilt.document_ids == first.document_ids

    document = workspace / "knowledge" / "guide.md"
    document.write_text(document.read_text(encoding="utf-8") + "\nChanged.\n", encoding="utf-8")

    with pytest.raises(ReleaseVersionError):
        create_octx(workspace, output=tmp_path / "same-version.octx")

    next_release = create_octx(workspace, version="1.0.1", output=tmp_path / "next.octx")
    assert next_release.asset_id == first.asset_id
    assert next_release.document_ids == first.document_ids
    assert next_release.package_digest != first.package_digest
    assert next_release.created_at != first.created_at


def test_new_release_does_not_reuse_unknown_manifest_attestations(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "one.octx")
    manifest_path = workspace / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["x-producer"] = {"mode": "curated"}
    manifest["asset"]["x-owner"] = "research"
    manifest["release"]["signature"] = "stale-release-signature"
    manifest["files"][0]["content_signature"] = "stale-file-signature"
    manifest["release"]["package_digest"] = package_digest(manifest)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    result = create_octx(workspace, version="1.0.1", output=tmp_path / "two.octx")
    package = open_octx(result.output)
    assert "x-producer" not in package.manifest
    assert "x-owner" not in package.manifest["asset"]
    assert "signature" not in package.manifest["release"]
    assert "content_signature" not in package.manifest["files"][0]


def test_published_manifest_is_an_immutable_baseline_after_state_recovery(
    markdown_source: Path, tmp_path: Path
) -> None:
    workspace = tmp_path / "workspace"
    first = create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "one.octx")
    state_path = workspace / ".octx/state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["releases"]["1.0.0"] = {"status": "building", "created_at": first.created_at}
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    document = workspace / "knowledge/guide.md"
    document.write_text(document.read_text(encoding="utf-8") + "\nChanged after publish.\n", encoding="utf-8")

    with pytest.raises(ReleaseVersionError, match="higher SemVer"):
        create_octx(workspace, output=tmp_path / "conflict.octx")

    assert not (tmp_path / "conflict.octx").exists()


def test_unpack_writes_only_the_valid_package(markdown_source: Path, tmp_path: Path) -> None:
    result = create_octx(tmp_path / "workspace", source=markdown_source, name="Guide", output=tmp_path / "guide.octx")
    destination = unpack_octx(result.output, tmp_path / "unpacked")

    assert (destination / "manifest.json").is_file()
    assert (destination / "knowledge" / "guide.md").is_file()
    assert validate_octx(destination).valid
    with pytest.raises(FileExistsError):
        unpack_octx(result.output, destination)


def test_output_does_not_overwrite_a_different_package(markdown_source: Path, tmp_path: Path) -> None:
    output = tmp_path / "existing.octx"
    output.write_bytes(b"unrelated")
    with pytest.raises(OutputExistsError):
        create_octx(tmp_path / "workspace", source=markdown_source, name="Guide", output=output)
    assert output.read_bytes() == b"unrelated"


def test_output_created_during_publish_is_not_overwritten(
    markdown_source: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "raced.octx"
    real_write = creation_module._write_archive

    def write_then_compete(*args, **kwargs):  # type: ignore[no-untyped-def]
        real_write(*args, **kwargs)
        output.write_bytes(b"competing publisher")

    monkeypatch.setattr(creation_module, "_write_archive", write_then_compete)

    with pytest.raises(OutputExistsError):
        create_octx(tmp_path / "workspace", source=markdown_source, name="Guide", output=output)

    assert output.read_bytes() == b"competing publisher"


def test_in_place_requires_explicit_confirmation(tmp_path: Path) -> None:
    workspace = tmp_path / "content"
    workspace.mkdir()
    (workspace / "guide.md").write_text("# Guide\n\nText.\n", encoding="utf-8")

    with pytest.raises(ConfirmationRequired) as error:
        create_octx(workspace, in_place=True, name="Guide", output=tmp_path / "guide.octx")
    assert error.value.changes
    assert (workspace / "guide.md").is_file()

    result = create_octx(
        workspace,
        in_place=True,
        confirm_in_place=True,
        name="Guide",
        output=tmp_path / "guide.octx",
    )
    assert result.report.valid
    assert not (workspace / "guide.md").exists()
    assert (workspace / "knowledge" / "guide.md").is_file()


def test_invalid_reserved_index_is_not_silently_rewritten(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# Guide\n", encoding="utf-8")
    (source / "index.md").write_text("This is not an OKF index.\n", encoding="utf-8")

    with pytest.raises(ValueError, match="index.md"):
        create_octx(tmp_path / "workspace", source=source, name="Guide", output=tmp_path / "guide.octx")


def test_create_preserves_existing_frontmatter_values(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    identifier = "019c7777-7777-7777-8777-777777777777"
    (source / "guide.md").write_text(
        "---\n"
        "type: Custom Knowledge\n"
        "title: Existing title\n"
        "description: Keep this\n"
        "tags: [one, two]\n"
        "octx:\n"
        f"  document_id: {identifier}\n"
        "---\n\n"
        "# Different H1\n\nBody.\n",
        encoding="utf-8",
    )
    result = create_octx(tmp_path / "workspace", source=source, name="Guide", output=tmp_path / "guide.octx")
    metadata = next(open_octx(result.output).iter_documents()).metadata
    assert metadata == {
        "type": "Custom Knowledge",
        "title": "Existing title",
        "description": "Keep this",
        "tags": ["one", "two"],
        "octx": {"document_id": identifier},
    }


def test_reimporting_identified_markdown_preserves_exact_source_bytes(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    identifier = "019c7777-7777-7777-8777-777777777777"
    raw = (
        "---\n"
        "# keep this comment\n"
        "type: Reference\n"
        "title: Guide\n"
        "tags: [one, two]\n"
        f"octx: {{document_id: {identifier}}}\n"
        "---\n\n"
        "# Guide\n"
    ).encode()
    (source / "guide.md").write_bytes(raw)
    workspace = tmp_path / "workspace"
    first = create_octx(workspace, source=source, name="Guide", output=tmp_path / "one.octx")

    second = create_octx(workspace, source=source, output=tmp_path / "two.octx")

    assert (workspace / "knowledge/guide.md").read_bytes() == raw
    assert second.package_digest == first.package_digest


def test_create_uses_a_non_compressing_container_for_highly_repetitive_content(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# Guide\n\n" + "a" * 300_000, encoding="utf-8")

    result = create_octx(tmp_path / "workspace", source=source, name="Guide", output=tmp_path / "guide.octx")

    assert result.report.valid
    assert validate_octx(result.output).valid


def test_uppercase_markdown_extension_is_not_partially_copied(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.MD").write_text("# Guide\n", encoding="utf-8")
    workspace = tmp_path / "workspace"

    with pytest.raises(ValueError, match="no .md files"):
        create_octx(workspace, source=source, name="Guide", output=tmp_path / "guide.octx")

    assert not (workspace / "knowledge/guide.MD").exists()


def test_reimporting_plain_markdown_reuses_document_identity(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    first = create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "one.octx")
    second = create_octx(workspace, source=markdown_source, output=tmp_path / "two.octx")
    assert second.document_ids == first.document_ids
    assert second.package_digest == first.package_digest


def test_source_refresh_cannot_reset_a_published_document_identity(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "one.octx")
    document = workspace / "knowledge/guide.md"
    document.write_text("---\ntype: Reference\noctx: broken\n---\n\n# Broken identity\n", encoding="utf-8")
    before = document.read_bytes()

    with pytest.raises(OctxFormatError, match="document_id"):
        create_octx(
            workspace,
            source=markdown_source,
            version="2.0.0",
            output=tmp_path / "two.octx",
        )

    assert document.read_bytes() == before
    assert not (tmp_path / "two.octx").exists()


def test_unpacked_package_cannot_be_adopted_as_a_local_asset(markdown_source: Path, tmp_path: Path) -> None:
    original = create_octx(
        tmp_path / "origin",
        source=markdown_source,
        name="Guide",
        output=tmp_path / "original.octx",
    )
    imported = unpack_octx(original.output, tmp_path / "imported")
    document = imported / "knowledge/guide.md"
    document.write_text(document.read_text(encoding="utf-8") + "\nThird-party edit.\n", encoding="utf-8")
    manifest_before = (imported / "manifest.json").read_bytes()

    with pytest.raises(DerivationRequired):
        create_octx(imported, version="2.0.0", output=tmp_path / "adopted.octx")

    assert (imported / "manifest.json").read_bytes() == manifest_before
    assert not (imported / ".octx").exists()
    assert not (tmp_path / "adopted.octx").exists()

    derived = create_octx(imported, derive=True, output=tmp_path / "derived.octx")
    derived_manifest = open_octx(derived.output).manifest
    original_manifest = open_octx(original.output).manifest
    assert derived.asset_id != original.asset_id
    assert derived.version == "1.0.0"
    assert derived_manifest["asset"]["derived_from"] == {
        "asset_id": original.asset_id,
        "version": original.version,
        "package_digest": original.package_digest,
    }
    assert original_manifest["asset"].get("derived_from") is None


def test_derived_asset_rebuilds_identity_scoped_manifest_fields(markdown_source: Path, tmp_path: Path) -> None:
    original = create_octx(
        tmp_path / "origin",
        source=markdown_source,
        name="Guide",
        output=tmp_path / "original.octx",
    )
    imported = unpack_octx(original.output, tmp_path / "imported")
    manifest_path = imported / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["x-package-attestation"] = "source-only"
    manifest["asset"]["publisher_attestation"] = "source-publisher"
    manifest["release"]["signature"] = "source-release"
    manifest["files"][0]["content_signature"] = "source-payload"
    manifest["release"]["package_digest"] = package_digest(manifest)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    derived = create_octx(imported, derive=True, output=tmp_path / "derived.octx")

    derived_manifest = open_octx(derived.output).manifest
    assert "x-package-attestation" not in derived_manifest
    assert "publisher_attestation" not in derived_manifest["asset"]
    assert "signature" not in derived_manifest["release"]
    assert "content_signature" not in derived_manifest["files"][0]
    assert derived_manifest["asset"]["derived_from"]["package_digest"] == manifest["release"]["package_digest"]

    document = imported / "knowledge/guide.md"
    document.write_text(document.read_text(encoding="utf-8") + "\nA derived revision.\n", encoding="utf-8")
    next_release = create_octx(imported, version="1.0.1", output=tmp_path / "derived-next.octx")
    assert open_octx(next_release.output).manifest["asset"]["derived_from"] == derived_manifest["asset"]["derived_from"]


def test_unchanged_external_directory_can_be_losslessly_recontainerized(
    markdown_source: Path, tmp_path: Path
) -> None:
    original = create_octx(
        tmp_path / "origin",
        source=markdown_source,
        name="Guide",
        output=tmp_path / "original.octx",
    )
    imported = unpack_octx(original.output, tmp_path / "imported")

    rebuilt = create_octx(imported, output=tmp_path / "rebuilt.octx")

    assert rebuilt.asset_id == original.asset_id
    assert rebuilt.version == original.version
    assert rebuilt.package_digest == original.package_digest
    assert not (imported / ".octx").exists()
    assert validate_octx(rebuilt.output).valid


def test_external_recontainer_ignores_safe_unlisted_files(markdown_source: Path, tmp_path: Path) -> None:
    original = create_octx(
        tmp_path / "origin",
        source=markdown_source,
        name="Guide",
        output=tmp_path / "original.octx",
    )
    imported = unpack_octx(original.output, tmp_path / "imported")
    extra = imported / "knowledge" / "extra.md"
    extra.write_text("# Not part of this Package\n", encoding="utf-8")

    rebuilt = create_octx(imported, output=tmp_path / "rebuilt.octx")

    assert rebuilt.asset_id == original.asset_id
    assert rebuilt.version == original.version
    assert rebuilt.package_digest == original.package_digest
    with open_octx(rebuilt.output) as package:
        assert "knowledge/extra.md" not in package.files
        assert "knowledge/extra.md" not in package.available_paths
    assert validate_octx(rebuilt.output).valid


def test_normal_release_cannot_silently_replace_a_document_id(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    first = create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "one.octx")
    document = workspace / "knowledge/guide.md"
    document.write_text("# Identity was removed\n", encoding="utf-8")

    with pytest.raises(OctxFormatError) as captured:
        create_octx(workspace, version="1.1.0", output=tmp_path / "two.octx")

    assert captured.value.code in {"OCTX_DOCUMENT_FRONTMATTER", "OCTX_DOCUMENT_ID_INVALID"}
    state = json.loads((workspace / ".octx/state.json").read_text(encoding="utf-8"))
    assert state["documents"]["knowledge/guide.md"] == first.document_ids["knowledge/guide.md"]
    assert not (tmp_path / "two.octx").exists()


def test_ready_unknown_layers_can_only_be_repacked_losslessly(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "core.octx")
    extension_path = "extensions/com.example.future/1.0/payload.bin"
    extension = workspace / extension_path
    extension.parent.mkdir(parents=True)
    extension.write_bytes(b"future-layer\x00payload")

    manifest_path = workspace / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["x-future"] = {"preserve": [1, 2, 3]}
    manifest["capabilities"] = {"future-index": {"version": "1.0", "x-mode": "exact"}}
    manifest["profiles"] = {"future-profile": {"version": "1.0"}}
    manifest["files"].append(
        {
            "path": extension_path,
            "sha256": hashlib.sha256(extension.read_bytes()).hexdigest(),
            "x-media-type": "application/octet-stream",
        }
    )
    manifest["release"]["package_digest"] = package_digest(manifest)
    manifest_path.write_bytes(json.dumps(manifest, ensure_ascii=False, indent=2).encode() + b"\n")
    state_path = workspace / ".octx/state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["releases"]["1.0.0"]["package_digest"] = manifest["release"]["package_digest"]
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    result = create_octx(workspace, output=tmp_path / "future.octx")
    assert result.report.valid
    assert not result.report.fully_validated
    assert result.package_digest == manifest["release"]["package_digest"]
    with open_octx(result.output) as package:
        assert package.read_payload(extension_path) == b"future-layer\x00payload"
        assert package.manifest["x-future"] == {"preserve": [1, 2, 3]}
        file_entry = next(entry for entry in package.manifest["files"] if entry["path"] == extension_path)
        assert file_entry["x-media-type"] == "application/octet-stream"

    extension.write_bytes(b"changed")
    with pytest.raises(ReleaseVersionError):
        create_octx(workspace, output=tmp_path / "changed-same-version.octx")
    with pytest.raises(OctxValidationError):
        create_octx(workspace, version="1.0.1", output=tmp_path / "changed-new-version.octx")


def test_failed_first_build_persists_asset_identity_for_retry(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    knowledge = workspace / "knowledge"
    knowledge.mkdir(parents=True)
    (knowledge / "guide.md").write_text("---\ntype: A\ntype: B\n---\n\nBody.\n", encoding="utf-8")

    with pytest.raises(yaml.YAMLError):
        create_octx(workspace, name="Guide", output=tmp_path / "failed.octx")
    state = json.loads((workspace / ".octx/state.json").read_text(encoding="utf-8"))
    asset_id = state["asset"]["id"]
    assert state["releases"]["1.0.0"]["status"] == "failed"

    (knowledge / "guide.md").write_text("# Guide\n\nFixed.\n", encoding="utf-8")
    result = create_octx(workspace, output=tmp_path / "ready.octx")
    assert result.asset_id == asset_id
    assert result.report.valid


def test_release_version_must_move_forward(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    create_octx(workspace, source=markdown_source, name="Guide", output=tmp_path / "one.octx")
    document = workspace / "knowledge/guide.md"
    document.write_text(document.read_text(encoding="utf-8") + "\nChanged.\n", encoding="utf-8")
    create_octx(workspace, version="1.1.0", output=tmp_path / "two.octx")

    with pytest.raises(ReleaseVersionError):
        create_octx(workspace, version="1.0.1", output=tmp_path / "rollback.octx")


def test_source_and_workspace_must_not_overlap(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# Guide\n", encoding="utf-8")

    with pytest.raises(ValueError, match="must not overlap"):
        create_octx(source / "workspace", source=source, name="Guide", output=tmp_path / "guide.octx")


def test_output_cannot_replace_a_managed_workspace_file(markdown_source: Path, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"

    with pytest.raises(ValueError, match="must not replace"):
        create_octx(
            workspace,
            source=markdown_source,
            name="Guide",
            output=workspace / "manifest.json",
        )

    assert not (workspace / "manifest.json").exists()


def test_in_place_always_requires_explicit_confirmation(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    knowledge = workspace / "knowledge"
    knowledge.mkdir(parents=True)
    (knowledge / "guide.md").write_text(concept_markdown(), encoding="utf-8")

    with pytest.raises(ConfirmationRequired) as captured:
        create_octx(workspace, in_place=True, name="Guide", output=tmp_path / "guide.octx")

    assert "write or update manifest.json" in captured.value.changes
    assert not (workspace / "manifest.json").exists()


def test_open_is_read_only_and_close_disables_further_reads(markdown_source: Path, tmp_path: Path) -> None:
    result = create_octx(tmp_path / "workspace", source=markdown_source, name="Guide", output=tmp_path / "guide.octx")
    before = result.output.stat().st_mtime_ns
    package = open_octx(result.output)
    assert package.read_payload("knowledge/guide.md")
    assert result.output.stat().st_mtime_ns == before
    package.close()
    with pytest.raises(ValueError, match="closed"):
        package.read_payload("knowledge/guide.md")


def test_validate_closes_only_packages_it_opens(markdown_source: Path, tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    result = create_octx(
        tmp_path / "workspace",
        source=markdown_source,
        name="Guide",
        output=tmp_path / "guide.octx",
    )
    closed: list[OctxPackage] = []
    real_close = OctxPackage.close

    def track_close(package: OctxPackage) -> None:
        closed.append(package)
        real_close(package)

    monkeypatch.setattr(OctxPackage, "close", track_close)

    assert validate_octx(result.output).valid
    assert len(closed) == 1

    caller_package = open_octx(result.output)
    try:
        closed.clear()
        assert validate_octx(caller_package, limits=caller_package.limits).valid
        assert closed == []
        assert caller_package.manifest["asset"]["id"] == result.asset_id

        reopened_limits = ArchiveLimits(max_issues=caller_package.limits.max_issues + 1)
        assert validate_octx(caller_package, limits=reopened_limits).valid
        assert len(closed) == 1
        assert closed[0] is not caller_package
        assert caller_package.manifest["asset"]["id"] == result.asset_id
    finally:
        caller_package.close()
