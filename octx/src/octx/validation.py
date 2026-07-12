from __future__ import annotations

import hashlib
import math
import os
import re
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime
from functools import cache
from typing import Any

from jsonschema import Draft202012Validator

from octx._documents import split_frontmatter, validate_reserved_document
from octx._paths import is_concept_path, is_reserved_knowledge_path
from octx._schemas import load_schema
from octx._strict import DuplicateKeyError, InvalidNumberError, loads_json, package_digest
from octx.errors import OctxError
from octx.models import ArchiveLimits, LayerResult, ValidationIssue, ValidationReport
from octx.package import OctxPackage, open_octx

_UUID7 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PACKAGE_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_DECLARATION_VERSION = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
_SUPPORTED_DECLARATION_VERSION = re.compile(r"^0\.1$")
_RFC3339_UTC = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z$"
)
_KNOWN_CAPABILITIES = ("sag-structured", "vectors")
_STANDARD_PATHS = {
    "data/chunks.jsonl": "sag-structured",
    "data/events.jsonl": "sag-structured",
    "relations/chunk-events.jsonl": "sag-structured",
    "data/entities.jsonl": "sag-structured",
    "relations/event-entities.jsonl": "sag-structured",
    "vectors/config.json": "vectors",
    "vectors/chunks.arrow": "vectors",
    "vectors/events.arrow": "vectors",
    "vectors/entities.arrow": "vectors",
}
_REQUIRED_PATHS = {
    "sag-structured": (
        "data/chunks.jsonl",
        "data/events.jsonl",
        "data/entities.jsonl",
        "relations/chunk-events.jsonl",
        "relations/event-entities.jsonl",
    ),
    "vectors": ("vectors/config.json",),
}
_RECORD_SCHEMAS = {
    "chunks": ("data/chunks.jsonl", "chunk.schema.json"),
    "events": ("data/events.jsonl", "event.schema.json"),
    "entities": ("data/entities.jsonl", "entity.schema.json"),
    "chunk-events": ("relations/chunk-events.jsonl", "chunk-event.schema.json"),
    "event-entities": ("relations/event-entities.jsonl", "event-entity.schema.json"),
}
_MAJOR_MINOR = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
_EXTENSION = re.compile(
    rf"^extensions/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+"
    rf"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/{_MAJOR_MINOR}/.+"
)


@dataclass
class _Collector:
    max_issues: int
    issues: list[ValidationIssue] = field(default_factory=list)
    layers: dict[str, list[ValidationIssue]] = field(default_factory=lambda: defaultdict(list))
    invalid: set[str] = field(default_factory=set)

    def add(
        self,
        layer: str,
        code: str,
        message: str,
        *,
        severity: str = "error",
        path: str | None = None,
        line: int | None = None,
        record_id: str | None = None,
    ) -> None:
        normalized_severity = "warning" if severity == "warning" else "error"
        if normalized_severity == "error":
            self.invalid.add(layer)
        if len(self.issues) >= self.max_issues:
            return
        issue = ValidationIssue(
            code=code,
            severity=normalized_severity,
            message=message,
            path=path,
            line=line,
            record_id=record_id,
        )
        self.issues.append(issue)
        self.layers[layer].append(issue)


@dataclass
class _Records:
    documents: dict[str, str] = field(default_factory=dict)
    chunks: dict[str, dict[str, Any]] = field(default_factory=dict)
    events: dict[str, dict[str, Any]] = field(default_factory=dict)
    entities: dict[str, dict[str, Any]] = field(default_factory=dict)
    chunk_events: set[tuple[str, str]] = field(default_factory=set)
    event_entities: set[tuple[str, str]] = field(default_factory=set)
    identities: dict[str, str] = field(default_factory=dict)


def _version(declaration: Any) -> str | None:
    return (
        declaration.get("version")
        if isinstance(declaration, dict) and isinstance(declaration.get("version"), str)
        else None
    )


def _valid_declaration(declaration: Any) -> bool:
    version = _version(declaration)
    return version is not None and _DECLARATION_VERSION.fullmatch(version) is not None


@cache
def _schema_validator(schema_name: str) -> Draft202012Validator:
    return Draft202012Validator(load_schema(schema_name))


def _schema_issues(
    value: Any,
    schema_name: str,
    collector: _Collector,
    layer: str,
    *,
    path: str,
    line: int | None = None,
    record_id: str | None = None,
) -> bool:
    valid = True
    validator = _schema_validator(schema_name)
    for error in sorted(validator.iter_errors(value), key=lambda item: tuple(str(part) for part in item.absolute_path)):
        location = ".".join(str(part) for part in error.absolute_path)
        message = f"{location}: {error.message}" if location else error.message
        collector.add(layer, "OCTX_SCHEMA_VALIDATION", message, path=path, line=line, record_id=record_id)
        valid = False
    return valid


def _manifest_schema_issues(manifest: dict[str, Any], collector: _Collector) -> None:
    validator = _schema_validator("manifest.schema.json")
    errors = sorted(
        validator.iter_errors(manifest),
        key=lambda item: tuple(str(part) for part in item.absolute_path),
    )
    for error in errors:
        parts = tuple(error.absolute_path)
        layer = "format"
        if len(parts) >= 2 and parts[0] == "capabilities" and isinstance(parts[1], str):
            layer = f"cap:{parts[1]}"
        location = ".".join(str(part) for part in parts)
        message = f"{location}: {error.message}" if location else error.message
        collector.add(layer, "OCTX_SCHEMA_VALIDATION", message, path="manifest.json")


def _valid_rfc3339_utc(value: Any) -> bool:
    if not isinstance(value, str) or _RFC3339_UTC.fullmatch(value) is None:
        return False
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return False
    return parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0


def _allowed_payload_path(path: str) -> bool:
    if path.startswith("knowledge/"):
        return path.endswith(".md")
    if path in _STANDARD_PATHS:
        return True
    return bool(_EXTENSION.fullmatch(path))


def _parse_jsonl(
    package: OctxPackage, path: str, collector: _Collector, layer: str
) -> Iterator[tuple[int, dict[str, Any]]]:
    try:
        for line_number, raw_line in package._iter_jsonl_lines(path):
            if not raw_line.strip():
                collector.add(
                    layer, "OCTX_JSONL_EMPTY_LINE", "JSONL contains an empty line", path=path, line=line_number
                )
                continue
            try:
                value = loads_json(raw_line, path=path, max_depth=package.limits.max_json_depth)
            except DuplicateKeyError as error:
                collector.add(layer, "OCTX_JSON_DUPLICATE_KEY", str(error), path=path, line=line_number)
                continue
            except (UnicodeError, InvalidNumberError, ValueError) as error:
                collector.add(layer, "OCTX_JSON_INVALID", str(error), path=path, line=line_number)
                continue
            if not isinstance(value, dict):
                collector.add(
                    layer, "OCTX_JSONL_RECORD_TYPE", "JSONL record must be an object", path=path, line=line_number
                )
                continue
            yield line_number, value
    except (KeyError, OctxError) as error:
        collector.add(layer, getattr(error, "code", "OCTX_FILE_MISSING"), str(error), path=path)


def _add_identity(
    records: _Records, collector: _Collector, layer: str, identifier: str, owner: str, **location: Any
) -> bool:
    existing = records.identities.get(identifier)
    if existing is not None:
        collector.add(
            layer,
            "OCTX_ID_DUPLICATE",
            f"identity {identifier} is already used by {existing}",
            record_id=identifier,
            **location,
        )
        return False
    records.identities[identifier] = owner
    return True


def _validate_format(
    package: OctxPackage,
    collector: _Collector,
    records: _Records,
) -> tuple[set[str], dict[str, Any], bool, bool]:
    manifest = package.manifest
    _manifest_schema_issues(manifest, collector)
    release = manifest.get("release") if isinstance(manifest.get("release"), dict) else {}
    if not _valid_rfc3339_utc(release.get("created_at")):
        collector.add(
            "format",
            "OCTX_RELEASE_CREATED_AT_INVALID",
            "release.created_at must be a real UTC RFC 3339 timestamp ending in Z",
            path="manifest.json",
        )

    asset = manifest.get("asset") if isinstance(manifest.get("asset"), dict) else {}
    asset_id = asset.get("id")
    if isinstance(asset_id, str) and _UUID7.fullmatch(asset_id):
        records.identities[asset_id] = "asset"
    derived_from = asset.get("derived_from") if isinstance(asset.get("derived_from"), dict) else {}
    if isinstance(asset_id, str) and derived_from.get("asset_id") == asset_id:
        collector.add(
            "format",
            "OCTX_ASSET_DERIVED_FROM_SELF",
            "a Derived Asset must have an asset.id different from asset.derived_from.asset_id",
            path="manifest.json",
        )

    format_version = manifest.get("format_version")
    format_supported = (
        manifest.get("format") == "octx"
        and isinstance(format_version, str)
        and format_version == "0.1"
    )
    if not format_supported:
        collector.add(
            "format",
            "OCTX_FORMAT_VERSION_UNSUPPORTED",
            f"OCTX {format_version or '?'} is not supported by this implementation",
            path="manifest.json",
        )

    manifest_files = manifest.get("files") if isinstance(manifest.get("files"), list) else []
    listed: set[str] = set()
    integrity_paths: set[str] = set()
    hashes_ok = True
    for entry in manifest_files:
        if not isinstance(entry, dict):
            hashes_ok = False
            continue
        path = entry.get("path")
        expected = entry.get("sha256")
        if not isinstance(path, str):
            hashes_ok = False
            continue
        if path == "manifest.json":
            collector.add("format", "OCTX_MANIFEST_SELF_LISTED", "manifest.json must not appear in files", path=path)
            continue
        if path in listed:
            collector.add("format", "OCTX_FILE_PATH_DUPLICATE", "manifest file path is duplicated", path=path)
            continue
        listed.add(path)
        if not _allowed_payload_path(path):
            collector.add(
                "format", "OCTX_PAYLOAD_PATH_UNSUPPORTED", "path is not a standard or extension payload", path=path
            )
        if not isinstance(expected, str) or not _SHA256.fullmatch(expected):
            hashes_ok = False
            continue
        if path not in package.available_paths:
            collector.add("format", "OCTX_FILE_MISSING", "manifest-listed file is missing", path=path)
            hashes_ok = False
            continue
        try:
            digest = hashlib.sha256()
            with package.open_payload(path) as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            actual = digest.hexdigest()
        except OctxError as error:
            collector.add("format", error.code, str(error), path=path)
            hashes_ok = False
            continue
        if actual != expected:
            collector.add("format", "OCTX_FILE_DIGEST_MISMATCH", "payload SHA-256 does not match manifest", path=path)
            hashes_ok = False
            continue
        integrity_paths.add(path)

    if not format_supported:
        hashes_ok = False
    elif (
        hashes_ok
        and isinstance(release.get("package_digest"), str)
        and _PACKAGE_DIGEST.fullmatch(release["package_digest"])
    ):
        try:
            computed = package_digest(manifest)
        except (KeyError, TypeError, ValueError) as error:
            collector.add("format", "OCTX_PACKAGE_DIGEST_INVALID", str(error), path="manifest.json")
            hashes_ok = False
        else:
            if computed != release["package_digest"]:
                collector.add(
                    "format",
                    "OCTX_PACKAGE_DIGEST_MISMATCH",
                    "release.package_digest does not match logical package content",
                    path="manifest.json",
                )
                hashes_ok = False
    else:
        hashes_ok = False

    capabilities = manifest.get("capabilities") if isinstance(manifest.get("capabilities"), dict) else {}
    for path, capability in _STANDARD_PATHS.items():
        if path in listed and capability not in capabilities:
            collector.add(
                "format",
                "OCTX_STANDARD_PATH_UNDECLARED",
                f"{path} requires the {capability}/0.1 capability declaration",
                path=path,
            )

    concepts = sorted((path for path in listed if is_concept_path(path)), key=str.encode)
    if not concepts:
        collector.add("format", "OCTX_CONCEPT_REQUIRED", "package must contain at least one Concept Document")

    if hashes_ok and format_supported:
        for path in sorted((value for value in listed if is_reserved_knowledge_path(value)), key=str.encode):
            if path not in integrity_paths:
                continue
            try:
                raw = package.read_payload(path)
            except OctxError as error:
                collector.add("format", error.code, str(error), path=path)
                continue
            try:
                validate_reserved_document(raw, path=path, max_depth=package.limits.max_yaml_depth)
            except Exception as error:
                collector.add("format", "OCTX_OKF_RESERVED_INVALID", str(error), path=path)
        for path in concepts:
            if path not in integrity_paths:
                continue
            try:
                raw = package.read_payload(path)
            except OctxError as error:
                collector.add("format", error.code, str(error), path=path)
                continue
            try:
                metadata, _ = split_frontmatter(raw, path=path, max_depth=package.limits.max_yaml_depth)
            except Exception as error:
                collector.add("format", "OCTX_DOCUMENT_FRONTMATTER", str(error), path=path)
                continue
            document_type = metadata.get("type")
            if not isinstance(document_type, str) or document_type == "":
                collector.add(
                    "format", "OCTX_DOCUMENT_TYPE_REQUIRED", "document type must be a non-empty string", path=path
                )
            namespace = metadata.get("octx")
            document_id = namespace.get("document_id") if isinstance(namespace, dict) else None
            if not isinstance(document_id, str) or not _UUID7.fullmatch(document_id):
                collector.add(
                    "format",
                    "OCTX_DOCUMENT_ID_INVALID",
                    "octx.document_id must be a canonical UUIDv7",
                    path=path,
                )
                continue
            if _add_identity(records, collector, "format", document_id, f"document {path}", path=path):
                records.documents[document_id] = path
    return integrity_paths, capabilities, hashes_ok, format_supported


def _require_paths(
    capability: str,
    package: OctxPackage,
    integrity_paths: set[str],
    collector: _Collector,
) -> bool:
    valid = True
    for path in _REQUIRED_PATHS.get(capability, ()):
        if path not in package.files:
            collector.add(
                f"cap:{capability}",
                "OCTX_CAPABILITY_FILE_REQUIRED",
                f"{capability}/0.1 requires {path}",
                path=path,
            )
            valid = False
        elif path not in integrity_paths:
            collector.add(
                f"cap:{capability}",
                "OCTX_CAPABILITY_FILE_UNTRUSTED",
                f"{path} did not pass OCTX integrity checks",
                path=path,
            )
            valid = False
    return valid


def _records_with_schema(
    package: OctxPackage,
    key: str,
    collector: _Collector,
    layer: str,
) -> Iterator[tuple[int, dict[str, Any]]]:
    path, schema = _RECORD_SCHEMAS[key]
    for line, value in _parse_jsonl(package, path, collector, layer):
        if _schema_issues(
            value,
            schema,
            collector,
            layer,
            path=path,
            line=line,
            record_id=value.get("id") if isinstance(value.get("id"), str) else None,
        ):
            yield line, value


def _validate_chunks(package: OctxPackage, collector: _Collector, records: _Records) -> None:
    layer = "cap:sag-structured"
    seen_ordinals: set[tuple[str, int]] = set()
    for line, chunk in _records_with_schema(package, "chunks", collector, layer):
        identifier = chunk["id"]
        if not _add_identity(records, collector, layer, identifier, "chunk", path="data/chunks.jsonl", line=line):
            continue
        if chunk["document_id"] not in records.documents:
            collector.add(
                layer,
                "OCTX_CHUNK_DOCUMENT_MISSING",
                "chunk.document_id does not reference a Concept Document",
                path="data/chunks.jsonl",
                line=line,
                record_id=identifier,
            )
        key = (chunk["document_id"], chunk["ordinal"])
        if key in seen_ordinals:
            collector.add(
                layer,
                "OCTX_CHUNK_ORDINAL_DUPLICATE",
                "chunk ordinal is duplicated within the document",
                path="data/chunks.jsonl",
                line=line,
                record_id=identifier,
            )
        seen_ordinals.add(key)
        records.chunks[identifier] = {
            "document_id": chunk["document_id"],
            "ordinal": chunk["ordinal"],
        }


def _validate_events(package: OctxPackage, collector: _Collector, records: _Records) -> None:
    layer = "cap:sag-structured"
    event_lines: dict[str, int] = {}
    for line, event in _records_with_schema(package, "events", collector, layer):
        identifier = event["id"]
        if not _add_identity(records, collector, layer, identifier, "event", path="data/events.jsonl", line=line):
            continue
        records.events[identifier] = {
            key: event[key] for key in ("parent_id", "level") if key in event
        }
        event_lines[identifier] = line

    for identifier, event in records.events.items():
        parent_id = event.get("parent_id")
        if parent_id is None:
            continue
        parent = records.events.get(parent_id)
        if parent is None:
            collector.add(
                layer,
                "OCTX_EVENT_PARENT_MISSING",
                "event.parent_id does not reference an Event",
                path="data/events.jsonl",
                line=event_lines[identifier],
                record_id=identifier,
            )
            continue
        expected = (parent.get("level") or 0) + 1
        if event.get("level") != expected:
            collector.add(
                layer,
                "OCTX_EVENT_LEVEL_INVALID",
                f"event.level must equal parent level + 1 ({expected})",
                path="data/events.jsonl",
                line=event_lines[identifier],
                record_id=identifier,
            )

    states: dict[str, int] = {}
    for start in records.events:
        if states.get(start) == 2:
            continue
        path: list[str] = []
        current = start
        while current in records.events and states.get(current, 0) == 0:
            states[current] = 1
            path.append(current)
            parent = records.events[current].get("parent_id")
            if not isinstance(parent, str):
                current = ""
                break
            current = parent
        if current in records.events and states.get(current) == 1:
            collector.add(
                layer,
                "OCTX_EVENT_HIERARCHY_CYCLE",
                "event hierarchy contains a cycle",
                path="data/events.jsonl",
                record_id=current,
            )
        for identifier in path:
            states[identifier] = 2

    seen_pairs: set[tuple[str, str]] = set()
    sourced_events: set[str] = set()
    for line, relation in _records_with_schema(package, "chunk-events", collector, layer):
        pair = (relation["chunk_id"], relation["event_id"])
        if pair in seen_pairs:
            collector.add(
                layer,
                "OCTX_CHUNK_EVENT_DUPLICATE",
                "chunk-event relation is duplicated",
                path="relations/chunk-events.jsonl",
                line=line,
            )
        seen_pairs.add(pair)
        if relation["chunk_id"] not in records.chunks:
            collector.add(
                layer,
                "OCTX_CHUNK_EVENT_CHUNK_MISSING",
                "chunk-event relation references a missing Chunk",
                path="relations/chunk-events.jsonl",
                line=line,
            )
        if relation["event_id"] not in records.events:
            collector.add(
                layer,
                "OCTX_CHUNK_EVENT_EVENT_MISSING",
                "chunk-event relation references a missing Event",
                path="relations/chunk-events.jsonl",
                line=line,
            )
        else:
            sourced_events.add(relation["event_id"])
        records.chunk_events.add(pair)
    for identifier in records.events.keys() - sourced_events:
        collector.add(
            layer,
            "OCTX_EVENT_WITHOUT_CHUNK",
            "every Event must reference at least one Chunk",
            path="relations/chunk-events.jsonl",
            record_id=identifier,
        )


def _validate_entities(package: OctxPackage, collector: _Collector, records: _Records) -> None:
    layer = "cap:sag-structured"
    for line, entity in _records_with_schema(package, "entities", collector, layer):
        identifier = entity["id"]
        if not _add_identity(records, collector, layer, identifier, "entity", path="data/entities.jsonl", line=line):
            continue
        records.entities[identifier] = {}

    seen_pairs: set[tuple[str, str]] = set()
    used_entities: set[str] = set()
    for line, relation in _records_with_schema(package, "event-entities", collector, layer):
        pair = (relation["event_id"], relation["entity_id"])
        if pair in seen_pairs:
            collector.add(
                layer,
                "OCTX_EVENT_ENTITY_DUPLICATE",
                "event-entity relation is duplicated",
                path="relations/event-entities.jsonl",
                line=line,
            )
        seen_pairs.add(pair)
        weight = relation.get("weight")
        if isinstance(weight, float) and not math.isfinite(weight):
            collector.add(
                layer,
                "OCTX_EVENT_ENTITY_WEIGHT_INVALID",
                "relation weight must be finite",
                path="relations/event-entities.jsonl",
                line=line,
            )
        if relation["event_id"] not in records.events:
            collector.add(
                layer,
                "OCTX_EVENT_ENTITY_EVENT_MISSING",
                "event-entity relation references a missing Event",
                path="relations/event-entities.jsonl",
                line=line,
            )
        if relation["entity_id"] not in records.entities:
            collector.add(
                layer,
                "OCTX_EVENT_ENTITY_ENTITY_MISSING",
                "event-entity relation references a missing Entity",
                path="relations/event-entities.jsonl",
                line=line,
            )
        else:
            used_entities.add(relation["entity_id"])
        records.event_entities.add(pair)
    for identifier in records.entities.keys() - used_entities:
        collector.add(
            layer,
            "OCTX_ENTITY_WITHOUT_EVENT",
            "every Entity must be referenced by at least one Event",
            path="relations/event-entities.jsonl",
            record_id=identifier,
        )


def _forbidden_vector_config_path(value: Any, prefix: tuple[str, ...] = ()) -> tuple[str, ...] | None:
    forbidden_tokens = {
        "api",
        "auth",
        "authorization",
        "credential",
        "credentials",
        "distance",
        "endpoint",
        "header",
        "headers",
        "host",
        "key",
        "metric",
        "normalization",
        "normalize",
        "password",
        "secret",
        "token",
        "url",
    }
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                continue
            expanded = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key)
            tokens = {token for token in re.split(r"[^A-Za-z0-9]+", expanded.casefold()) if token}
            compact = "".join(tokens)
            current = (*prefix, key)
            if tokens & forbidden_tokens or compact in {
                "accesskey",
                "accesstoken",
                "apikey",
                "apiurl",
                "baseurl",
                "serviceurl",
            }:
                return current
            nested = _forbidden_vector_config_path(child, current)
            if nested is not None:
                return nested
    elif isinstance(value, list):
        for index, child in enumerate(value):
            nested = _forbidden_vector_config_path(child, (*prefix, str(index)))
            if nested is not None:
                return nested
    elif isinstance(value, str) and re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", value):
        return prefix
    return None


def _validate_vectors(
    package: OctxPackage,
    collector: _Collector,
    records: _Records,
    integrity_paths: set[str],
) -> bool:
    layer = "cap:vectors"
    config_path = "vectors/config.json"
    if config_path not in package.files:
        collector.add(
            layer, "OCTX_VECTOR_CONFIG_REQUIRED", "vectors/0.1 requires vectors/config.json", path=config_path
        )
        return True
    try:
        config = loads_json(
            package.read_payload(config_path), path=config_path, max_depth=package.limits.max_json_depth
        )
    except DuplicateKeyError as error:
        collector.add(layer, "OCTX_JSON_DUPLICATE_KEY", str(error), path=config_path)
        return True
    except (OctxError, UnicodeError, InvalidNumberError, ValueError) as error:
        collector.add(layer, "OCTX_VECTOR_CONFIG_INVALID", str(error), path=config_path)
        return True
    _schema_issues(config, "vector-config.schema.json", collector, layer, path=config_path)
    forbidden_path = _forbidden_vector_config_path(config)
    if forbidden_path is not None:
        collector.add(
            layer,
            "OCTX_VECTOR_CONFIG_FORBIDDEN",
            f"vector config contains local connection, secret, or retrieval settings at {'.'.join(forbidden_path)}",
            path=config_path,
        )

    targets = {
        target: f"vectors/{target}.arrow"
        for target in ("chunks", "events", "entities")
        if f"vectors/{target}.arrow" in package.files
    }
    if not targets:
        collector.add(layer, "OCTX_VECTOR_TARGET_REQUIRED", "vectors/0.1 requires at least one Arrow target")
        return True
    try:
        import pyarrow as pa
        import pyarrow.compute as pc
    except ImportError:
        collector.add(
            layer,
            "OCTX_VECTOR_SUPPORT_UNAVAILABLE",
            "install octx[vectors] to validate Arrow payloads",
            severity="warning",
        )
        return False

    expected_by_target = {
        "chunks": set(records.chunks),
        "events": set(records.events),
        "entities": set(records.entities),
    }
    for target, path in targets.items():
        if path not in integrity_paths:
            collector.add(
                layer,
                "OCTX_CAPABILITY_FILE_UNTRUSTED",
                f"{path} did not pass OCTX integrity checks",
                path=path,
            )
            continue
        try:
            with package._open_vector_reader(target) as reader:
                schema = reader.schema
                if schema.names.count("record_id") != 1 or schema.names.count("vector") != 1:
                    collector.add(
                        layer,
                        "OCTX_VECTOR_COLUMNS_REQUIRED",
                        "Arrow file requires exactly one record_id and one vector column",
                        path=path,
                    )
                    continue
                record_field = schema.field("record_id")
                vector_field = schema.field("vector")
                record_schema_valid = record_field.type == pa.string() and not record_field.nullable
                if not record_schema_valid:
                    collector.add(layer, "OCTX_VECTOR_RECORD_ID_SCHEMA", "record_id must be non-null utf8", path=path)
                vector_schema_valid = (
                    pa.types.is_fixed_size_list(vector_field.type)
                    and vector_field.type.value_type == pa.float32()
                    and not vector_field.nullable
                )
                if not vector_schema_valid:
                    collector.add(
                        layer,
                        "OCTX_VECTOR_VALUE_SCHEMA",
                        "vector must be a non-null fixed_size_list<float32>",
                        path=path,
                    )
                if not record_schema_valid or not vector_schema_valid:
                    continue
                dimension = vector_field.type.list_size
                if dimension <= 0 or dimension > package.limits.max_arrow_dimension:
                    collector.add(
                        layer,
                        "OCTX_VECTOR_DIMENSION_INVALID",
                        "vector dimension is outside configured limits",
                        path=path,
                    )
                    continue

                expected = expected_by_target[target]
                remaining = set(expected)
                duplicate = False
                unexpected = False
                nulls = False
                finite = True
                for batch in package._iter_reader_batches(target, reader):
                    record_column = batch.column(schema.get_field_index("record_id"))
                    vector_column = batch.column(schema.get_field_index("vector"))
                    nulls = nulls or bool(record_column.null_count or vector_column.null_count)
                    for scalar in record_column:
                        record_id = scalar.as_py()
                        if record_id in remaining:
                            remaining.remove(record_id)
                        elif record_id in expected:
                            duplicate = True
                        else:
                            unexpected = True
                    values = vector_column.flatten()
                    if values.null_count or (len(values) and pc.all(pc.is_finite(values)).as_py() is not True):
                        finite = False
                if nulls:
                    collector.add(layer, "OCTX_VECTOR_NULL", "vector columns must not contain nulls", path=path)
                if duplicate:
                    collector.add(
                        layer,
                        "OCTX_VECTOR_RECORD_ID_DUPLICATE",
                        "record_id values must be unique",
                        path=path,
                    )
                if remaining or unexpected:
                    collector.add(
                        layer,
                        "OCTX_VECTOR_COVERAGE",
                        "Arrow record_id values must exactly cover target records",
                        path=path,
                    )
                if not finite:
                    collector.add(
                        layer,
                        "OCTX_VECTOR_VALUE_INVALID",
                        "vectors must contain only finite float32 values",
                        path=path,
                    )
        except OctxError as error:
            collector.add(layer, error.code, str(error), path=path)
        except Exception as error:
            collector.add(layer, "OCTX_VECTOR_ARROW_INVALID", f"invalid Arrow payload: {error}", path=path)
    return True


def _validate_sag_coverage(records: _Records, collector: _Collector) -> None:
    layer = "cap:sag-structured"
    chunks_by_document = {chunk["document_id"] for chunk in records.chunks.values()}
    for identifier, path in records.documents.items():
        if identifier not in chunks_by_document:
            collector.add(
                layer,
                "OCTX_SAG_DOCUMENT_WITHOUT_CHUNK",
                "every Concept Document must have at least one Chunk",
                path=path,
                record_id=identifier,
            )
    chunks_with_events = {chunk_id for chunk_id, _ in records.chunk_events}
    for identifier in records.chunks.keys() - chunks_with_events:
        collector.add(
            layer,
            "OCTX_SAG_CHUNK_WITHOUT_EVENT",
            "every Chunk must have at least one Event",
            path="relations/chunk-events.jsonl",
            record_id=identifier,
        )
    events_with_entities = {event_id for event_id, _ in records.event_entities}
    for identifier in records.events.keys() - events_with_entities:
        collector.add(
            layer,
            "OCTX_SAG_EVENT_WITHOUT_ENTITY",
            "every Event must have at least one Entity",
            path="relations/event-entities.jsonl",
            record_id=identifier,
        )


def _layer_result(
    collector: _Collector,
    layer: str,
    *,
    declared: bool,
    version: str | None,
    valid: bool | None = None,
    fully_validated: bool = True,
) -> LayerResult:
    if valid is None and fully_validated:
        valid = layer not in collector.invalid
    return LayerResult(
        declared=declared,
        valid=valid,
        version=version,
        fully_validated=fully_validated,
        issues=tuple(collector.layers.get(layer, ())),
    )


def _report_for_open_error(error: Exception) -> ValidationReport:
    code = getattr(error, "code", "OCTX_OPEN_ERROR")
    issue = ValidationIssue(
        code=code,
        severity="error",
        message=str(error),
        path=getattr(error, "path", None),
        line=getattr(error, "line", None),
    )
    format_result = LayerResult(declared=True, valid=False, issues=(issue,))
    return ValidationReport(format=format_result, issues=(issue,))


def validate_octx(
    package_or_source: OctxPackage | os.PathLike[str] | str,
    *,
    limits: ArchiveLimits | None = None,
    max_issues: int | None = None,
) -> ValidationReport:
    if max_issues is not None and (
        isinstance(max_issues, bool) or not isinstance(max_issues, int) or max_issues <= 0
    ):
        raise ValueError("max_issues must be a positive integer")
    selected_limits = limits or (
        package_or_source.limits if isinstance(package_or_source, OctxPackage) else ArchiveLimits()
    )
    owns_package = not isinstance(package_or_source, OctxPackage) or (
        limits is not None and selected_limits != package_or_source.limits
    )
    if owns_package:
        source = package_or_source.source if isinstance(package_or_source, OctxPackage) else package_or_source
        try:
            package = open_octx(source, limits=selected_limits)
        except (OctxError, OSError, ValueError) as error:
            return _report_for_open_error(error)
        with package:
            return validate_octx(package, max_issues=max_issues)

    package = package_or_source
    try:
        manifest = package.manifest
    except (OctxError, OSError, ValueError) as error:
        return _report_for_open_error(error)

    collector = _Collector(max_issues=max_issues or selected_limits.max_issues)
    records = _Records()
    integrity_paths, capability_declarations, integrity_ok, format_supported = _validate_format(
        package, collector, records
    )
    format_valid = "format" not in collector.invalid
    format_usable = integrity_ok and format_supported and format_valid

    capability_results: dict[str, LayerResult] = {}
    supported_capabilities: dict[str, bool] = {}
    fully_validated_capabilities: dict[str, bool] = {}
    for name, declaration in capability_declarations.items():
        version = _version(declaration)
        layer = f"cap:{name}"
        if not _valid_declaration(declaration):
            collector.add(
                layer,
                "OCTX_CAPABILITY_DECLARATION_INVALID",
                f"capability {name} must declare a major.minor version",
            )
            capability_results[name] = _layer_result(
                collector,
                layer,
                declared=True,
                version=version,
            )
            continue
        if name not in _KNOWN_CAPABILITIES or _SUPPORTED_DECLARATION_VERSION.fullmatch(version or "") is None:
            collector.add(
                layer,
                "OCTX_CAPABILITY_UNSUPPORTED",
                f"capability {name}/{version or '?'} is not supported by this implementation",
                severity="warning",
            )
            capability_results[name] = _layer_result(
                collector,
                layer,
                declared=True,
                version=version,
                valid=None,
                fully_validated=False,
            )
            continue
        if not format_usable:
            collector.add(
                layer,
                "OCTX_CAPABILITY_DEPENDENCY_INVALID",
                "capability payload was not read because the OCTX format is invalid or unsupported",
            )
            supported_capabilities[name] = False
            fully_validated_capabilities[name] = False
        else:
            supported_capabilities[name] = _require_paths(name, package, integrity_paths, collector)
            fully_validated_capabilities[name] = True

    if "sag-structured" in supported_capabilities:
        if supported_capabilities["sag-structured"]:
            _validate_chunks(package, collector, records)
            _validate_events(package, collector, records)
            _validate_entities(package, collector, records)
            _validate_sag_coverage(records, collector)
        supported_capabilities["sag-structured"] = "cap:sag-structured" not in collector.invalid
    if "vectors" in supported_capabilities:
        if not supported_capabilities["vectors"]:
            pass
        elif not supported_capabilities.get("sag-structured", False):
            collector.add(
                "cap:vectors",
                "OCTX_CAPABILITY_DEPENDENCY_INVALID",
                "vectors/0.1 requires a valid sag-structured/0.1 capability",
            )
        else:
            fully_validated_capabilities["vectors"] = _validate_vectors(
                package, collector, records, integrity_paths
            )
        supported_capabilities["vectors"] = "cap:vectors" not in collector.invalid

    for name in supported_capabilities:
        fully_validated = fully_validated_capabilities[name]
        valid = supported_capabilities[name] if fully_validated or not format_usable else None
        capability_results[name] = _layer_result(
            collector,
            f"cap:{name}",
            declared=True,
            version=_version(capability_declarations[name]),
            valid=valid,
            fully_validated=fully_validated,
        )

    format_result = _layer_result(
        collector,
        "format",
        declared=True,
        version=manifest.get("format_version"),
        fully_validated=format_supported,
    )
    return ValidationReport(
        format=format_result,
        capabilities=capability_results,
        issues=tuple(collector.issues),
    )
