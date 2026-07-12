from __future__ import annotations

import copy
import hashlib
import json
import math
from typing import Any

import rfc8785


class DuplicateKeyError(ValueError):
    def __init__(self, key: str) -> None:
        super().__init__(f"duplicate JSON key: {key}")
        self.key = key


class InvalidNumberError(ValueError):
    pass


def decode_utf8(data: bytes, *, path: str) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        raise UnicodeError(f"{path} must not contain a UTF-8 BOM")
    return data.decode("utf-8", errors="strict")


def decode_markdown_utf8(data: bytes, *, path: str) -> str:
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    return data.decode("utf-8", errors="strict")


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(key)
        result[key] = value
    return result


def _constant(value: str) -> None:
    raise InvalidNumberError(f"invalid JSON number: {value}")


def _float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise InvalidNumberError(f"JSON number is not finite: {value}")
    return parsed


def _check_depth(text: str, *, max_depth: int) -> None:
    depth = 0
    in_string = False
    escaped = False
    for character in text:
        if in_string:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character in "[{":
            depth += 1
            if depth > max_depth:
                raise ValueError(f"JSON nesting exceeds {max_depth}")
        elif character in "]}":
            depth -= 1


def loads_json(data: bytes, *, path: str, max_depth: int = 100) -> Any:
    text = decode_utf8(data, path=path)
    _check_depth(text, max_depth=max_depth)
    return json.loads(
        text,
        object_pairs_hook=_object,
        parse_constant=_constant,
        parse_float=_float,
    )


def pretty_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def package_digest(manifest: dict[str, Any]) -> str:
    canonical = copy.deepcopy(manifest)
    release = canonical.get("release")
    if not isinstance(release, dict):
        raise ValueError("manifest.release must be an object")
    release.pop("package_digest", None)
    files = canonical.get("files")
    if not isinstance(files, list):
        raise ValueError("manifest.files must be an array")

    def path_key(item: Any) -> bytes:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("every manifest.files entry must have a string path")
        return item["path"].encode("utf-8")

    files.sort(key=path_key)
    encoded = rfc8785.dumps(canonical)
    return "sha256:" + hashlib.sha256(encoded).hexdigest()
