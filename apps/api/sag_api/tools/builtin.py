"""内置工具 —— 把引擎能力包成 Agent 可调用的工具。

`search_context`（检索）与 `get_entity` 会随本轮可见信源自动挂载，再由模型按需调用。
Agent 循环对它们与远端 MCP 工具使用同一契约。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sag_api.core.config import settings
from sag_api.generation import build_citations
from sag_api.services.retrieval_service import retrieve_relevant_sections
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
        limit = max(1, min(int(top_k or 8), 50))
        outcome = await retrieve_relevant_sections(
            ctx.engine_manager,
            ctx.sources,
            query,
            # 未在人格中指定时沿用全局快速/精确设置。
            strategy=persona.get("search_strategy"),
            top_k=limit,
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
            data={
                "sections": sections,
                "section_count": len(sections),
                "lexical_count": int(outcome.stats.get("lexical_candidates") or 0),
                "filtered_count": int(outcome.stats.get("filtered_irrelevant") or 0),
                "candidate_count": int(outcome.stats.get("candidates") or len(sections)),
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


class GetTimeTool(Tool):
    meta = ToolMeta(
        name="get_time",
        description=(
            "获取准确的当前日期、时间、星期与 UTC 偏移。"
            "用户询问现在、今天、当前时间、相对日期或跨时区换算时使用；"
            "不传 timezone 时使用系统设定时区。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "timezone": {
                    "type": "string",
                    "description": "可选 IANA 时区，例如 Asia/Shanghai、UTC、America/New_York",
                    "maxLength": 100,
                }
            },
            "additionalProperties": False,
        },
    )

    async def invoke(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        del ctx
        timezone_name = str(args.get("timezone") or settings.timezone).strip()
        try:
            zone = ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError):
            return ToolResult(
                content=(
                    f"无法识别时区「{timezone_name}」。请使用 IANA 时区名称；"
                    f"当前系统时区为 {settings.timezone}。"
                ),
                data={"ok": False, "timezone": timezone_name},
            )

        now_utc = datetime.now(UTC)
        local = now_utc.astimezone(zone)
        offset = local.strftime("%z")
        formatted_offset = f"{offset[:3]}:{offset[3:]}" if len(offset) == 5 else offset
        weekdays = ("星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日")
        return ToolResult(
            content=(
                f"当前时间：{local:%Y-%m-%d %H:%M:%S} {weekdays[local.weekday()]} "
                f"（{timezone_name}，UTC{formatted_offset}）\n"
                f"UTC 时间：{now_utc:%Y-%m-%d %H:%M:%S} UTC"
            ),
            data={
                "ok": True,
                "timezone": timezone_name,
                "utc_offset": formatted_offset,
                "local_iso": local.isoformat(),
                "utc_iso": now_utc.isoformat(),
                "unix_seconds": int(now_utc.timestamp()),
            },
        )
