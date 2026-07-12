from __future__ import annotations

import copy
import json
import zipfile
from pathlib import Path

import pytest
from conftest import DOC_ID, concept_markdown, repack

from octx import ArchiveLimits, create_octx, open_octx, validate_octx
from octx._strict import package_digest
from octx.errors import OctxFormatError


def _base_package(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text(concept_markdown(), encoding="utf-8")
    return create_octx(tmp_path / "workspace", source=source, name="Guide", output=tmp_path / "guide.octx").output


def test_package_digest_uses_rfc8785_golden_value() -> None:
    manifest = {
        "format": "octx",
        "format_version": "0.1",
        "asset": {"id": DOC_ID, "name": "é"},
        "release": {
            "version": "1.0.0",
            "created_at": "2026-07-12T10:00:00Z",
            "package_digest": "sha256:" + "0" * 64,
        },
        "files": [{"path": "knowledge/é.md", "sha256": "a" * 64}],
        "x-number": 1e-7,
    }
    assert package_digest(manifest) == "sha256:5d12e761e3aab0cb2fd68863a6d3fee6866b722004b48a8b1018eec80d6656a5"


def test_package_digest_ignores_archive_order_compression_and_timestamp(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    repacked = repack(
        package,
        tmp_path / "repacked.octx",
        compression=zipfile.ZIP_STORED,
        reverse=True,
    )

    original = open_octx(package).manifest["release"]["package_digest"]
    assert open_octx(repacked).manifest["release"]["package_digest"] == original
    assert validate_octx(repacked).valid
    assert package.read_bytes() != repacked.read_bytes()


@pytest.mark.parametrize(
    "created_at",
    [
        "2026-99-99T99:99:99Z",
        "2026-07-12T10:00:60Z",
    ],
)
def test_created_at_requires_octx_rfc3339_utc_profile(tmp_path: Path, created_at: str) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["release"]["created_at"] = created_at

    invalid = repack(package, tmp_path / "bad-time.octx", mutate_manifest=mutate)
    report = validate_octx(invalid)
    assert not report.format.valid
    assert "OCTX_RELEASE_CREATED_AT_INVALID" in report.issue_codes


def test_markdown_accepts_optional_utf8_bom(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    with_bom = repack(
        package,
        tmp_path / "markdown-bom.octx",
        replacements={"knowledge/guide.md": b"\xef\xbb\xbf" + concept_markdown().encode()},
    )

    report = validate_octx(with_bom)
    assert report.format.valid
    with open_octx(with_bom) as opened:
        document = next(opened.iter_documents())
        assert document.raw.startswith(b"\xef\xbb\xbf")
        assert document.metadata["type"] == "Reference"
        assert "# Guide" in document.body


def test_manifest_json_still_rejects_utf8_bom(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    with zipfile.ZipFile(package) as archive:
        entries = {info.filename: archive.read(info) for info in archive.infolist()}
    entries["manifest.json"] = b"\xef\xbb\xbf" + entries["manifest.json"]
    invalid = tmp_path / "manifest-bom.octx"
    with zipfile.ZipFile(invalid, "w") as archive:
        for path, data in entries.items():
            archive.writestr(path, data)

    with pytest.raises(OctxFormatError, match="must not contain a UTF-8 BOM"):
        open_octx(invalid)


def test_format_rejects_unrecognized_draft_versions(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["format_version"] = "0.2"
        manifest["x-optional-field"] = {"preserved": True}

    unsupported = repack(package, tmp_path / "format-0.2.octx", mutate_manifest=mutate)
    report = validate_octx(unsupported)

    assert not report.format.valid
    assert not report.valid
    assert report.format.version == "0.2"
    assert "OCTX_FORMAT_VERSION_UNSUPPORTED" in report.issue_codes


def test_asset_cannot_claim_to_be_derived_from_itself(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["asset"]["derived_from"] = {
            "asset_id": manifest["asset"]["id"],
            "version": manifest["release"]["version"],
            "package_digest": manifest["release"]["package_digest"],
        }

    self_derived = repack(package, tmp_path / "self-derived.octx", mutate_manifest=mutate)
    report = validate_octx(self_derived)

    assert not report.format.valid
    assert "OCTX_ASSET_DERIVED_FROM_SELF" in report.issue_codes


def test_malformed_manifest_file_path_returns_a_report(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    with zipfile.ZipFile(package) as archive:
        entries = {info.filename: archive.read(info) for info in archive.infolist()}
    manifest = json.loads(entries["manifest.json"])
    manifest["files"].append({"path": 123, "sha256": "0" * 64})
    entries["manifest.json"] = (json.dumps(manifest) + "\n").encode()
    malformed = tmp_path / "malformed-path.octx"
    with zipfile.ZipFile(malformed, "w") as archive:
        for path, data in entries.items():
            archive.writestr(path, data)

    report = validate_octx(malformed)

    assert not report.format.valid
    assert "OCTX_SCHEMA_VALIDATION" in report.issue_codes


def test_unknown_capability_keeps_package_readable_but_is_not_claimed_valid(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["capabilities"] = {"future-index": {"version": "1.0"}}

    future = repack(package, tmp_path / "future.octx", mutate_manifest=mutate)
    report = validate_octx(future)
    assert report.format.valid
    assert report.valid
    assert not report.fully_validated
    assert report.capabilities["future-index"].valid is None


def test_issue_limit_never_hides_an_invalid_layer(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["capabilities"] = {
            "future-index": {"version": "1.0"},
            "chunks": {"version": "0.1"},
        }

    limited = repack(package, tmp_path / "limited.octx", mutate_manifest=mutate)
    report = validate_octx(limited, max_issues=1)

    assert len(report.issues) == 1
    assert report.capabilities["chunks"].valid is False
    assert not report.valid


def test_issue_limit_must_be_positive(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="max_issues"):
        validate_octx(_base_package(tmp_path), max_issues=0)


def test_declared_missing_capability_file_does_not_invalidate_format(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["capabilities"] = {"chunks": {"version": "0.1"}}

    missing = repack(package, tmp_path / "missing-chunks.octx", mutate_manifest=mutate)
    report = validate_octx(missing)
    assert report.format.valid
    assert not report.capabilities["chunks"].valid
    assert not report.valid
    assert "OCTX_CAPABILITY_FILE_REQUIRED" in report.issue_codes


def test_standard_payload_without_declaration_is_a_format_error(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["files"].append({"path": "data/chunks.jsonl", "sha256": "0" * 64})

    invalid = repack(
        package,
        tmp_path / "undeclared.octx",
        replacements={"data/chunks.jsonl": b""},
        mutate_manifest=mutate,
    )
    report = validate_octx(invalid)
    assert not report.format.valid
    assert "OCTX_STANDARD_PATH_UNDECLARED" in report.issue_codes


def test_package_requires_a_concept_document(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["files"] = [entry for entry in manifest["files"] if entry["path"] != "knowledge/guide.md"]

    invalid = repack(
        package,
        tmp_path / "no-concept.octx",
        replacements={"knowledge/guide.md": None},
        mutate_manifest=mutate,
    )
    report = validate_octx(invalid)
    assert not report.format.valid
    assert "OCTX_CONCEPT_REQUIRED" in report.issue_codes


def test_document_id_is_unique_across_the_package(tmp_path: Path) -> None:
    package = _base_package(tmp_path)

    def mutate(manifest: dict) -> None:
        manifest["files"].append({"path": "knowledge/second.md", "sha256": "0" * 64})

    invalid = repack(
        package,
        tmp_path / "duplicate-document.octx",
        replacements={"knowledge/second.md": concept_markdown(title="Second").encode()},
        mutate_manifest=mutate,
    )
    report = validate_octx(invalid)
    assert not report.format.valid
    assert "OCTX_ID_DUPLICATE" in report.issue_codes


@pytest.mark.parametrize(
    "frontmatter",
    [
        f"---\ntype: Reference\ntype: Other\noctx:\n  document_id: {DOC_ID}\n---\n\nText.\n",
        f"---\ntype: Reference\nx: &value [1, 2]\noctx:\n  document_id: {DOC_ID}\n---\n\nText.\n",
        f"---\ntype: Reference\nx: &value [1, 2]\ny: *value\noctx:\n  document_id: {DOC_ID}\n---\n\nText.\n",
    ],
)
def test_yaml_duplicate_keys_and_aliases_are_rejected(tmp_path: Path, frontmatter: str) -> None:
    package = _base_package(tmp_path)
    invalid = repack(
        package,
        tmp_path / "bad-yaml.octx",
        replacements={"knowledge/guide.md": frontmatter.encode()},
    )
    report = validate_octx(invalid)
    assert not report.format.valid
    assert "OCTX_DOCUMENT_FRONTMATTER" in report.issue_codes


def test_reserved_document_yaml_errors_return_a_report(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    invalid_index = b'---\nokf_version: "0.1"\nokf_version: "0.1"\n---\n\n# Index\n\n- [Guide](guide.md)\n'

    def mutate(manifest: dict) -> None:
        manifest["files"].append({"path": "knowledge/index.md", "sha256": "0" * 64})

    invalid = repack(
        package,
        tmp_path / "bad-index-yaml.octx",
        replacements={"knowledge/index.md": invalid_index},
        mutate_manifest=mutate,
    )
    report = validate_octx(invalid)

    assert not report.format.valid
    assert "OCTX_OKF_RESERVED_INVALID" in report.issue_codes


def test_reserved_document_unhashable_yaml_key_returns_a_report(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    invalid_log = b"---\n? [a, b]\n: value\n---\n\n# Log\n\n## 2026-07-12\n"

    def mutate(manifest: dict) -> None:
        manifest["files"].append({"path": "knowledge/log.md", "sha256": "0" * 64})

    invalid = repack(
        package,
        tmp_path / "unhashable-log-key.octx",
        replacements={"knowledge/log.md": invalid_log},
        mutate_manifest=mutate,
    )

    report = validate_octx(invalid)

    assert not report.format.valid
    assert "OCTX_OKF_RESERVED_INVALID" in report.issue_codes


def test_configured_json_depth_limit_applies_before_manifest_parsing(tmp_path: Path) -> None:
    package = _base_package(tmp_path)
    report = validate_octx(package, limits=ArchiveLimits(max_json_depth=2))
    assert not report.valid
    assert "OCTX_MANIFEST_JSON_INVALID" in report.issue_codes


def test_package_digest_does_not_mutate_the_manifest_argument() -> None:
    manifest = {
        "release": {"package_digest": "sha256:" + "0" * 64},
        "files": [
            {"path": "z", "sha256": "b" * 64},
            {"path": "a", "sha256": "a" * 64},
        ],
    }
    original = copy.deepcopy(manifest)
    package_digest(manifest)
    assert manifest == original
