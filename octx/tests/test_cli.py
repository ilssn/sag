from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-m", "octx", *args], check=False, capture_output=True, text=True)


def test_cli_create_inspect_validate_and_unpack(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# Guide\n\nText.\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    output = tmp_path / "guide.octx"

    created = _run(
        "create",
        str(workspace),
        "--from",
        str(source),
        "--name",
        "Guide",
        "-o",
        str(output),
        "--json",
    )
    assert created.returncode == 0, created.stderr
    assert json.loads(created.stdout)["status"] == "ready"

    inspected = _run("inspect", str(output), "--json")
    assert inspected.returncode == 0, inspected.stderr
    inspection = json.loads(inspected.stdout)
    assert inspection["asset"]["name"] == "Guide"
    assert inspection["validation_performed"] is False
    assert "profiles" not in inspection

    validated = _run("validate", str(output), "--json")
    assert validated.returncode == 0, validated.stderr
    validation = json.loads(validated.stdout)
    assert validation["valid"] is True
    assert "profiles" not in validation

    destination = tmp_path / "unpacked"
    unpacked = _run("unpack", str(output), str(destination))
    assert unpacked.returncode == 0, unpacked.stderr
    assert (destination / "manifest.json").is_file()


def test_cli_validate_returns_one_for_invalid_input(tmp_path: Path) -> None:
    invalid = tmp_path / "invalid.octx"
    invalid.write_bytes(b"not a zip")
    result = _run("validate", str(invalid), "--json")
    assert result.returncode == 1
    assert json.loads(result.stdout)["valid"] is False


def test_cli_json_mode_returns_structured_runtime_errors(tmp_path: Path) -> None:
    result = _run("inspect", str(tmp_path / "missing.octx"), "--json")

    assert result.returncode == 2
    assert result.stderr == ""
    assert json.loads(result.stdout)["error"]["code"] == "OCTX_IO_ERROR"


def test_cli_json_mode_formats_argument_errors() -> None:
    result = _run("create", "--json")

    assert result.returncode == 2
    assert result.stderr == ""
    assert json.loads(result.stdout)["error"]["code"] == "OCTX_USAGE_ERROR"


def test_cli_json_mode_formats_invalid_yaml(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("---\ntype: A\ntype: B\n---\n", encoding="utf-8")
    result = _run(
        "create",
        str(tmp_path / "workspace"),
        "--from",
        str(source),
        "--name",
        "Invalid",
        "--output",
        str(tmp_path / "invalid.octx"),
        "--json",
    )

    assert result.returncode == 2
    assert result.stderr == ""
    assert json.loads(result.stdout)["error"]["code"] == "OCTX_FORMAT_ERROR"


def test_cli_inspect_tolerates_unvalidated_manifest_shapes(tmp_path: Path) -> None:
    package = tmp_path / "odd.octx"
    manifest = {
        "format": "octx",
        "format_version": "0.1",
        "asset": "not-an-object",
        "release": "not-an-object",
        "files": [],
    }
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))

    result = _run("inspect", str(package), "--json")
    inspection = json.loads(result.stdout)
    assert result.returncode == 0, result.stderr
    assert inspection["asset"] == {}
    assert inspection["release"] == {}


def test_cli_inspect_counts_only_concept_documents(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# Guide\n", encoding="utf-8")
    (source / "index.md").write_text("# Index\n\n- [Guide](guide.md)\n", encoding="utf-8")
    output = tmp_path / "guide.octx"
    created = _run(
        "create",
        str(tmp_path / "workspace"),
        "--from",
        str(source),
        "--name",
        "Guide",
        "-o",
        str(output),
    )
    assert created.returncode == 0, created.stderr

    inspected = _run("inspect", str(output), "--json")
    assert json.loads(inspected.stdout)["documents"] == 1
