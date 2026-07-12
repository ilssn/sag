from __future__ import annotations

import re
from datetime import date
from pathlib import PurePosixPath
from typing import Any

import yaml

from octx._strict import decode_markdown_utf8


class StrictYamlLoader(yaml.SafeLoader):
    max_depth = 100

    def __init__(self, stream: str) -> None:
        super().__init__(stream)
        self._depth = 0

    def compose_node(self, parent, index):  # type: ignore[no-untyped-def]
        event = self.peek_event()
        if isinstance(event, yaml.AliasEvent) or getattr(event, "anchor", None) is not None:
            raise yaml.YAMLError("YAML anchors and aliases are not allowed")
        self._depth += 1
        if self._depth > self.max_depth:
            raise yaml.YAMLError(f"YAML nesting exceeds {self.max_depth}")
        try:
            return super().compose_node(parent, index)
        finally:
            self._depth -= 1

    def construct_mapping(self, node, deep=False):  # type: ignore[no-untyped-def]
        if not isinstance(node, yaml.MappingNode):
            raise yaml.constructor.ConstructorError(None, None, "expected a mapping node", node.start_mark)
        mapping: dict[Any, Any] = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            try:
                duplicate = key in mapping
            except TypeError as error:
                raise yaml.constructor.ConstructorError(
                    "while constructing a mapping",
                    node.start_mark,
                    f"found unhashable key {key!r}",
                    key_node.start_mark,
                ) from error
            if duplicate:
                raise yaml.constructor.ConstructorError(
                    "while constructing a mapping",
                    node.start_mark,
                    f"found duplicate key {key!r}",
                    key_node.start_mark,
                )
            mapping[key] = self.construct_object(value_node, deep=deep)
        return mapping


def load_yaml(text: str, *, max_depth: int = 100) -> Any:
    loader = StrictYamlLoader(text)
    loader.max_depth = max_depth
    try:
        return loader.get_single_data()
    finally:
        loader.dispose()


def split_frontmatter(data: bytes, *, path: str, max_depth: int = 100, required: bool = True) -> tuple[dict, str]:
    text = decode_markdown_utf8(data, path=path)
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n") != "---":
        if required:
            raise ValueError(f"{path} requires YAML frontmatter")
        return {}, text
    closing = next((index for index, line in enumerate(lines[1:], start=1) if line.rstrip("\r\n") == "---"), None)
    if closing is None:
        raise ValueError(f"{path} has unclosed YAML frontmatter")
    yaml_text = "".join(lines[1:closing])
    metadata = load_yaml(yaml_text, max_depth=max_depth)
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, dict):
        raise ValueError(f"{path} frontmatter must be an object")
    return metadata, "".join(lines[closing + 1 :])


def render_document(metadata: dict[str, Any], body: str) -> bytes:
    yaml_text = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False, default_flow_style=False).rstrip()
    normalized_body = body.lstrip("\r\n")
    return f"---\n{yaml_text}\n---\n\n{normalized_body}".encode()


def first_h1(body: str) -> str | None:
    in_fence = False
    for line in body.splitlines():
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            continue
        if not in_fence:
            match = re.match(r"^#\s+(.+?)\s*$", line)
            if match:
                return match.group(1).strip()
    return None


def derived_title(path: str, body: str) -> str:
    return first_h1(body) or PurePosixPath(path).stem.replace("-", " ").replace("_", " ").strip()


def validate_reserved_document(data: bytes, *, path: str, max_depth: int = 100) -> None:
    text = decode_markdown_utf8(data, path=path)
    name = PurePosixPath(path).name
    body = text
    if text.startswith("---"):
        metadata, body = split_frontmatter(data, path=path, max_depth=max_depth)
        if name != "index.md" or path != "knowledge/index.md":
            raise ValueError(f"{path} must not contain frontmatter")
        if set(metadata) - {"okf_version"}:
            raise ValueError(f"{path} root frontmatter only permits okf_version")
    if not re.search(r"(?m)^#\s+\S", body):
        raise ValueError(f"{path} must contain a level-one heading")
    if name == "index.md":
        if not re.search(r"(?m)^\s*[*+-]\s+\[[^]]+\]\([^)]+\)", body):
            raise ValueError(f"{path} must contain at least one Markdown link entry")
        return
    headings = re.findall(r"(?m)^##\s+(\d{4}-\d{2}-\d{2})\s*$", body)
    if not headings:
        raise ValueError(f"{path} must contain ISO date headings")
    parsed = [date.fromisoformat(value) for value in headings]
    if parsed != sorted(parsed, reverse=True):
        raise ValueError(f"{path} date headings must be newest first")
