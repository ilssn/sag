from __future__ import annotations

import copy
import hashlib
import json
import zipfile
from collections.abc import Callable
from pathlib import Path

import pytest
import rfc8785

DOC_ID = "019c1234-5678-7abc-8def-0123456789ab"
CHUNK_ID = "019c2222-2222-7222-8222-222222222222"
CHUNK_2_ID = "019c3333-3333-7333-8333-333333333333"
EVENT_ID = "019c4444-4444-7444-8444-444444444444"
ENTITY_ID = "019c5555-5555-7555-8555-555555555555"


@pytest.fixture
def markdown_source(tmp_path: Path) -> Path:
    source = tmp_path / "source"
    source.mkdir()
    (source / "guide.md").write_text("# OCTX Guide\n\nPortable context.\n", encoding="utf-8")
    return source


def write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records), encoding="utf-8")


def concept_markdown(*, document_id: str = DOC_ID, title: str = "Guide") -> str:
    return (
        "---\n"
        "type: Reference\n"
        f"title: {title}\n"
        "octx:\n"
        f"  document_id: {document_id}\n"
        "---\n\n"
        f"# {title}\n\nPortable context.\n"
    )


def repack(
    source: Path,
    target: Path,
    *,
    replacements: dict[str, bytes | None] | None = None,
    mutate_manifest: Callable[[dict], None] | None = None,
    compression: int = zipfile.ZIP_DEFLATED,
    reverse: bool = False,
) -> Path:
    with zipfile.ZipFile(source) as archive:
        entries = {info.filename: archive.read(info) for info in archive.infolist() if not info.is_dir()}
    for name, content in (replacements or {}).items():
        if content is None:
            entries.pop(name, None)
        else:
            entries[name] = content
    manifest = json.loads(entries["manifest.json"])
    if mutate_manifest:
        mutate_manifest(manifest)
    for file_entry in manifest["files"]:
        if file_entry["path"] in entries:
            file_entry["sha256"] = hashlib.sha256(entries[file_entry["path"]]).hexdigest()
    digest_manifest = copy.deepcopy(manifest)
    digest_manifest["release"].pop("package_digest", None)
    digest_manifest["files"].sort(key=lambda item: item["path"].encode("utf-8"))
    manifest["release"]["package_digest"] = "sha256:" + hashlib.sha256(rfc8785.dumps(digest_manifest)).hexdigest()
    entries["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    with zipfile.ZipFile(target, "w", compression=compression) as archive:
        for name, content in sorted(entries.items(), reverse=reverse):
            archive.writestr(name, content)
    return target


def mutate_and_rehash(source: Path, target: Path, replacements: dict[str, bytes]) -> Path:
    return repack(source, target, replacements=replacements)
