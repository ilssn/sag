from __future__ import annotations

import re
import unicodedata
from pathlib import PurePosixPath

from octx.errors import OctxSecurityError

_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:")


def logical_path(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise OctxSecurityError("logical path must be a non-empty string")
    if "\x00" in value:
        raise OctxSecurityError("logical path contains NUL", path=value)
    if "\\" in value:
        raise OctxSecurityError("logical path must use POSIX separators", path=value)
    if value.startswith("/") or value.startswith("//") or _WINDOWS_DRIVE.match(value):
        raise OctxSecurityError("logical path must be relative", path=value)
    if unicodedata.normalize("NFC", value) != value:
        raise OctxSecurityError("logical path must use Unicode NFC", path=value)
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise OctxSecurityError("logical path contains an unsafe segment", path=value)
    normalized = PurePosixPath(*parts).as_posix()
    if normalized != value:
        raise OctxSecurityError("logical path is not canonical", path=value)
    return normalized


def is_concept_path(path: str) -> bool:
    if not path.startswith("knowledge/") or not path.endswith(".md"):
        return False
    return PurePosixPath(path).name not in {"index.md", "log.md"}


def is_reserved_knowledge_path(path: str) -> bool:
    return path.startswith("knowledge/") and PurePosixPath(path).name in {"index.md", "log.md"}
