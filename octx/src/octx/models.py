from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class ArchiveLimits:
    """Resource limits applied before and during package reads."""

    max_entries: int = 10_000
    max_file_size: int = 512 * 1024 * 1024
    max_total_uncompressed: int = 4 * 1024 * 1024 * 1024
    max_compression_ratio: float = 200.0
    max_jsonl_line_size: int = 16 * 1024 * 1024
    max_jsonl_records: int = 1_000_000
    max_json_depth: int = 100
    max_yaml_depth: int = 100
    max_arrow_dimension: int = 65_536
    max_arrow_batches: int = 100_000
    max_arrow_rows: int = 10_000_000
    max_arrow_values: int = 100_000_000
    max_issues: int = 1_000

    def __post_init__(self) -> None:
        for name in (
            "max_entries",
            "max_file_size",
            "max_total_uncompressed",
            "max_jsonl_line_size",
            "max_jsonl_records",
            "max_json_depth",
            "max_yaml_depth",
            "max_arrow_dimension",
            "max_arrow_batches",
            "max_arrow_rows",
            "max_arrow_values",
            "max_issues",
        ):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.max_compression_ratio <= 0:
            raise ValueError("max_compression_ratio must be positive")


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    code: str
    severity: Literal["error", "warning"]
    message: str
    path: str | None = None
    line: int | None = None
    record_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
        }
        if self.path is not None:
            result["path"] = self.path
        if self.line is not None:
            result["line"] = self.line
        if self.record_id is not None:
            result["record_id"] = self.record_id
        return result


@dataclass(frozen=True, slots=True)
class LayerResult:
    declared: bool
    valid: bool | None
    version: str | None = None
    fully_validated: bool = True
    issues: tuple[ValidationIssue, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "declared": self.declared,
            "valid": self.valid,
            "version": self.version,
            "fully_validated": self.fully_validated,
            "issues": [issue.to_dict() for issue in self.issues],
        }


@dataclass(frozen=True, slots=True)
class ValidationReport:
    format: LayerResult
    capabilities: Mapping[str, LayerResult] = field(default_factory=dict)
    profiles: Mapping[str, LayerResult] = field(default_factory=dict)
    issues: tuple[ValidationIssue, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "capabilities", MappingProxyType(dict(self.capabilities)))
        object.__setattr__(self, "profiles", MappingProxyType(dict(self.profiles)))

    @property
    def valid(self) -> bool:
        if self.format.valid is not True:
            return False
        return all(layer.valid is not False for layer in (*self.capabilities.values(), *self.profiles.values()))

    @property
    def fully_validated(self) -> bool:
        return self.format.fully_validated and all(
            layer.fully_validated for layer in (*self.capabilities.values(), *self.profiles.values())
        )

    @property
    def issue_codes(self) -> frozenset[str]:
        return frozenset(issue.code for issue in self.issues)

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "fully_validated": self.fully_validated,
            "format": self.format.to_dict(),
            "capabilities": {name: result.to_dict() for name, result in self.capabilities.items()},
            "profiles": {name: result.to_dict() for name, result in self.profiles.items()},
            "issues": [issue.to_dict() for issue in self.issues],
        }


@dataclass(frozen=True, slots=True)
class Document:
    path: str
    metadata: Mapping[str, Any]
    body: str
    raw: bytes

    def __post_init__(self) -> None:
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))


@dataclass(frozen=True, slots=True)
class CreateResult:
    output: Path
    workspace: Path
    asset_id: str
    version: str
    created_at: str
    package_digest: str
    document_ids: Mapping[str, str]
    report: ValidationReport
    status: Literal["ready"] = "ready"

    def __post_init__(self) -> None:
        object.__setattr__(self, "document_ids", MappingProxyType(dict(self.document_ids)))

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "output": str(self.output),
            "workspace": str(self.workspace),
            "asset_id": self.asset_id,
            "version": self.version,
            "created_at": self.created_at,
            "package_digest": self.package_digest,
            "document_ids": dict(self.document_ids),
            "validation": self.report.to_dict(),
        }
