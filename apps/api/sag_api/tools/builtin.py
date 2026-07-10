"""内置工具 —— 把引擎能力包成 Agent 可调用的工具。

`search_context`（检索）是 Agent 的第一等工具：对有信源绑定的助手会被自动播种，
也可由模型显式再调；`get_entity` 让模型按需查实体上下文。二者都只是工具——
Agent 循环对它们与未来的 MCP 工具一视同仁。
"""

from __future__ import annotations

from typing import Any

from sag_api.generation import build_citations
from sag_api.tools.base import Tool, ToolContext, ToolMeta, ToolResult


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
        sections = outcome.sections
        source_refs = {s.sag_source_config_id: {"id": s.id, "name": s.name} for s in ctx.sources}
        offset = max(0, ctx.citation_offset)
        citations = build_citations(sections, source_refs)
        for c in citations:
            c["n"] = c["n"] + offset
        return ToolResult(
            content=_format_sections(sections, offset),
            citations=citations,
            data={"sections": sections, "section_count": len(sections)},
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
            entities = await ctx.engine_manager.list_entities(scid, limit=200)
            match = next((e for e in entities if (e.name or "").lower() == lowered), None)
            if match is None:
                match = next((e for e in entities if lowered in (e.name or "").lower()), None)
            if match is not None:
                snippets = await ctx.engine_manager.entity_context(scid, match.id, limit=6)
                body = "\n\n".join(snippets) if snippets else match.description or ""
                return ToolResult(
                    content=f"实体「{match.name}」（{match.type}）：\n{body}".strip(),
                    data={"entity_id": match.id, "source_id": source.id},
                )
        return ToolResult(content="（未找到该实体）")
