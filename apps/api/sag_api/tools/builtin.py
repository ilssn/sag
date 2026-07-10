"""内置工具 —— 把引擎能力包成 Agent 可调用的工具。

`search_context`（检索）与 `get_entity` 会随本轮可见信源自动挂载，再由模型按需调用。
Agent 循环对它们与远端 MCP 工具使用同一契约。
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from sag_api.generation import build_citations
from sag_api.sag import RetrievedSection
from sag_api.tools.base import Tool, ToolContext, ToolMeta, ToolResult

_QUERY_NOISE = (
    "知识库",
    "资料库",
    "资料中",
    "文档中",
    "告诉我",
    "帮我查",
    "搜索",
    "查询",
    "请问",
    "关于",
    "最新",
    "最近",
    "动态",
    "消息",
    "新闻",
    "明星",
    "娱乐圈",
    "内容",
    "资料",
    "一下",
    "是什么",
    "有哪些",
    "有什么",
)


def _query_terms(query: str) -> list[str]:
    """提取适合精确召回的短词，弥补网页长分块的向量偏移。"""

    cleaned = query.strip()
    for phrase in _QUERY_NOISE:
        cleaned = cleaned.replace(phrase, " ")
    candidates = re.findall(r"[A-Za-z0-9][A-Za-z0-9_.+-]{1,31}|[\u3400-\u9fff]{2,12}", cleaned)
    terms: list[str] = []
    for candidate in candidates:
        value = candidate.strip()
        if value and not value.isdigit() and value not in terms:
            terms.append(value)
    return terms[:3]


async def _lexical_sections(
    ctx: ToolContext,
    query: str,
    *,
    score: float,
) -> list[RetrievedSection]:
    terms = _query_terms(query)
    if not terms:
        return []

    calls = [
        (source, term, ctx.engine_manager.grep_chunks(
            source.sag_source_config_id,
            term,
            source=source,
            limit=2,
        ))
        for source in ctx.sources
        for term in terms
    ]
    results = await asyncio.gather(*(call for _, _, call in calls), return_exceptions=True)
    sections: list[RetrievedSection] = []
    for (source, _term, _call), rows in zip(calls, results, strict=True):
        if isinstance(rows, BaseException):
            continue
        for index, row in enumerate(rows):
            sections.append(
                RetrievedSection(
                    chunk_id=row.get("chunk_id"),
                    heading=row.get("heading") or "精确匹配",
                    content=row.get("snippet") or "",
                    score=max(0.0, score - index * 0.01),
                    rank=index,
                    source_config_id=source.sag_source_config_id,
                )
            )
    return sections


def _merge_sections(
    lexical: list[RetrievedSection],
    semantic: list[RetrievedSection],
    *,
    limit: int,
) -> list[RetrievedSection]:
    merged: list[RetrievedSection] = []
    chunk_ids: set[str] = set()
    fingerprints: set[str] = set()
    for section in [*lexical, *semantic]:
        fingerprint = re.sub(r"\s+", " ", section.content).strip()[:180]
        if section.chunk_id and section.chunk_id in chunk_ids:
            continue
        if fingerprint and fingerprint in fingerprints:
            continue
        if section.chunk_id:
            chunk_ids.add(section.chunk_id)
        if fingerprint:
            fingerprints.add(fingerprint)
        merged.append(section)
        if len(merged) >= limit:
            break
    return merged


def _useful_semantic_sections(
    sections: list[RetrievedSection],
    query: str,
    *,
    has_lexical: bool,
) -> list[RetrievedSection]:
    if not has_lexical:
        return sections
    terms = [term.lower() for term in _query_terms(query)]
    boilerplate = ("新浪首页", "权利保护声明", "阅读排行榜", "评论排行榜", "点击加载更多")
    useful: list[RetrievedSection] = []
    for section in sections:
        text = f"{section.heading}\n{section.content}"
        lowered = text.lower()
        if terms and not any(term in lowered for term in terms):
            continue
        if sum(marker in text for marker in boilerplate) >= 2:
            continue
        useful.append(section)
    return useful


def _format_sections(sections: list, offset: int = 0) -> str:
    if not sections:
        return "（无相关资料）"
    blocks = []
    for i, s in enumerate(sections, start=1 + offset):
        heading = getattr(s, "heading", None) or "片段"
        blocks.append(f"[{i}] {heading}\n{getattr(s, 'content', '')}")
    return "\n\n".join(blocks)


class SearchContextTool(Tool):
    meta = ToolMeta(
        name="search_context",
        description=(
            "在知识库中检索资料片段，返回带全局编号的证据（引用时用 [n]）。"
            "可多轮调用：每次用不同角度/更具体的查询改写，直到证据足够。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "要检索的问题或关键词"},
                "top_k": {"type": "integer", "description": "返回条数（可选）", "minimum": 1, "maximum": 50},
            },
            "required": ["query"],
        },
    )

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        query = (args.get("query") or "").strip()
        if not query or not ctx.sources:
            return ToolResult(content="（无相关资料）", citations=[], data={"section_count": 0})
        persona = ctx.persona or {}
        top_k = args.get("top_k") or persona.get("top_k")
        targets = [(s.sag_source_config_id, s) for s in ctx.sources]
        outcome = await ctx.engine_manager.search_many(
            # 默认 vector（毫秒级）：多轮改写补召回；multi 图谱增强需人格显式开启
            targets, query, strategy=persona.get("search_strategy") or "vector", top_k=top_k
        )
        limit = max(1, min(int(top_k or 8), 50))
        lexical_score = max([section.score for section in outcome.sections] or [0.9]) + 0.05
        lexical = await _lexical_sections(ctx, query, score=lexical_score)
        semantic = _useful_semantic_sections(
            outcome.sections,
            query,
            has_lexical=bool(lexical),
        )
        sections = _merge_sections(lexical, semantic, limit=limit)
        source_refs = {s.sag_source_config_id: {"id": s.id, "name": s.name} for s in ctx.sources}
        offset = max(0, ctx.citation_offset)
        citations = build_citations(sections, source_refs)
        for c in citations:
            c["n"] = c["n"] + offset
        return ToolResult(
            content=_format_sections(sections, offset),
            citations=citations,
            data={
                "sections": sections,
                "section_count": len(sections),
                "lexical_count": len(lexical),
                "semantic_count": len(semantic),
            },
        )


class GetEntityTool(Tool):
    meta = ToolMeta(
        name="get_entity",
        description="按名称查询某个实体在资料中的相关事件与上下文，用于人物/概念澄清。",
        parameters={
            "type": "object",
            "properties": {"name": {"type": "string", "description": "实体名称"}},
            "required": ["name"],
        },
    )

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        name = (args.get("name") or "").strip()
        if not name or not ctx.sources:
            return ToolResult(content="（未找到该实体）")
        lowered = name.lower()
        for source in ctx.sources:
            scid = source.sag_source_config_id
            entities = await ctx.engine_manager.list_entities(scid, source=source, limit=200)
            match = next((e for e in entities if (e.name or "").lower() == lowered), None)
            if match is None:
                match = next((e for e in entities if lowered in (e.name or "").lower()), None)
            if match is not None:
                snippets = await ctx.engine_manager.entity_context(
                    scid, match.id, source=source, limit=6
                )
                body = "\n\n".join(snippets) if snippets else match.description or ""
                return ToolResult(
                    content=f"实体「{match.name}」（{match.type}）：\n{body}".strip(),
                    data={"entity_id": match.id, "source_id": source.id},
                )
        return ToolResult(content="（未找到该实体）")
