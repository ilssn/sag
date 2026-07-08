"""信源即 MCP —— 把一个信源的检索/实体/原文能力暴露为标准 MCP server。

一个 sag 实例只需**一个** FastMCP server：具体服务哪个信源由「作用域」
（`MCPScope`：暖引擎 + Source）在每次请求前经 contextvar 注入——
- HTTP 端点（`mount.py`）从 `?source_id=` 解析信源、鉴权后设置作用域；
- 进程内 agent / stdio 入口在调用前直接设置作用域。

处理器直接调 `EngineManager`（复用暖引擎，无二次预热、无锁外争用），
与内置工具 `search_context`/`get_entity` 走同一条引擎路径，保证「同源同解」。
"""

from __future__ import annotations

import contextlib
import contextvars
from dataclasses import dataclass
from typing import TYPE_CHECKING

from mcp.server.fastmcp import FastMCP

if TYPE_CHECKING:
    from sag_api.db.models import Source
    from sag_api.sag import EngineManager


@dataclass
class MCPScope:
    """一次 MCP 调用作用的信源与其暖引擎。"""

    engine_manager: EngineManager
    source: Source


_scope: contextvars.ContextVar[MCPScope | None] = contextvars.ContextVar(
    "sag_mcp_scope", default=None
)


def _require_scope() -> MCPScope:
    scope = _scope.get()
    if scope is None:
        raise RuntimeError("MCP 调用缺少信源作用域（source scope 未注入）")
    return scope


@contextlib.contextmanager
def use_scope(engine_manager: EngineManager, source: Source):
    """在此上下文内把调用绑定到某个信源（HTTP 中间件 / stdio 入口 / 测试共用）。"""
    token = _scope.set(MCPScope(engine_manager=engine_manager, source=source))
    try:
        yield
    finally:
        _scope.reset(token)


def _sections_to_text(sections: list) -> str:
    if not sections:
        return "（无相关资料）"
    blocks = []
    for i, s in enumerate(sections, start=1):
        heading = getattr(s, "heading", None) or "片段"
        chunk_id = getattr(s, "chunk_id", None) or ""
        tag = f"（chunk_id={chunk_id}）" if chunk_id else ""
        blocks.append(f"[{i}] {heading}{tag}\n{getattr(s, 'content', '')}")
    return "\n\n".join(blocks)


def build_source_mcp(*, stateless_http: bool = False) -> FastMCP:
    """构造 sag 的信源 MCP server（工具从 contextvar 取当前信源作用域）。

    `stateless_http=True` 用于进程内 HTTP 挂载：每个请求自带 `?source_id=` 且独立
    鉴权，无需会话粘性。stdio 入口用默认（有状态）即可。
    """
    mcp = FastMCP(
        "sag-source",
        instructions=(
            "sag 单个信源的 MCP 端点：search 检索证据、get_entity 查实体上下文、"
            "get_chunk 读原文分块。回答请依据 search 返回的带编号证据并标注 [n]。"
        ),
        stateless_http=stateless_http,
    )

    @mcp.tool(description="在该信源中检索与问题相关的资料片段，返回带编号的证据（含 chunk_id）。")
    async def search(query: str, top_k: int = 8) -> str:
        scope = _require_scope()
        q = (query or "").strip()
        if not q:
            return "（空查询）"
        outcome = await scope.engine_manager.search(
            scope.source.sag_source_config_id, q, source=scope.source, top_k=top_k
        )
        return _sections_to_text(outcome.sections)

    @mcp.tool(description="按名称查询某个实体在该信源中的相关事件与上下文，用于人物/概念澄清。")
    async def get_entity(name: str) -> str:
        scope = _require_scope()
        target = (name or "").strip()
        if not target:
            return "（未找到该实体）"
        scid = scope.source.sag_source_config_id
        entities = await scope.engine_manager.list_entities(scid, source=scope.source, limit=200)
        lowered = target.lower()
        match = next((e for e in entities if (e.name or "").lower() == lowered), None)
        if match is None:
            match = next((e for e in entities if lowered in (e.name or "").lower()), None)
        if match is None:
            return "（未找到该实体）"
        snippets = await scope.engine_manager.entity_context(
            scid, match.id, source=scope.source, limit=6
        )
        body = "\n\n".join(snippets) if snippets else (match.description or "")
        return f"实体「{match.name}」（{match.type}）：\n{body}".strip()

    @mcp.tool(description="列出该信源的全部文档（id/文件名/状态/计数），探索的起点。")
    async def list_documents() -> str:
        scope = _require_scope()
        from sqlalchemy import select

        from sag_api.core.db import SessionLocal
        from sag_api.db.models import Document

        async with SessionLocal() as session:
            docs = (
                (
                    await session.execute(
                        select(Document)
                        .where(Document.source_id == scope.source.id)
                        .order_by(Document.created_at)
                    )
                )
                .scalars()
                .all()
            )
        if not docs:
            return "（该信源还没有文档）"
        return "\n".join(
            f"- {d.filename} · id={d.id} · {d.status.value} · {d.chunk_count} 分块"
            for d in docs
        )

    @mcp.tool(description="某文档的大纲（分块 heading 按顺序），先看结构再精确取内容。")
    async def outline(document_id: str) -> str:
        scope = _require_scope()
        from sag_api.core.db import SessionLocal
        from sag_api.db.models import Document

        async with SessionLocal() as session:
            doc = await session.get(Document, (document_id or "").strip())
        if doc is None or doc.source_id != scope.source.id:
            return "（未找到该文档）"
        rows = await scope.engine_manager.list_chunk_headings(
            scope.source.sag_source_config_id,
            source=scope.source,
            doc_sag_id=doc.sag_source_id,
        )
        if not rows:
            return "（尚无大纲：文档可能仍在处理中）"
        return "\n".join(
            f"{r['rank']:>3}. {r['heading'] or '（无标题分块）'}（chunk_id={r['chunk_id']}）"
            for r in rows
        )

    @mcp.tool(description="精确文本匹配（大小写不敏感）：找专名/编号/代码段等确定性内容。")
    async def grep(pattern: str, limit: int = 20) -> str:
        scope = _require_scope()
        needle = (pattern or "").strip()
        if not needle:
            return "（空匹配串）"
        rows = await scope.engine_manager.grep_chunks(
            scope.source.sag_source_config_id, needle, source=scope.source, limit=limit
        )
        if not rows:
            return "（未匹配到内容）"
        return "\n\n".join(
            f"[{i}] {r['heading'] or '片段'}（chunk_id={r['chunk_id']}）\n{r['snippet']}"
            for i, r in enumerate(rows, start=1)
        )

    @mcp.tool(description="按行分页读取文档原始文件（offset 从 1 起，limit 默认 120 行）。")
    async def read(document_id: str, offset: int = 1, limit: int = 120) -> str:
        scope = _require_scope()
        import os

        from sag_api.core.db import SessionLocal
        from sag_api.db.models import Document

        async with SessionLocal() as session:
            doc = await session.get(Document, (document_id or "").strip())
        if doc is None or doc.source_id != scope.source.id:
            return "（未找到该文档）"
        if not doc.storage_path or not os.path.isfile(doc.storage_path):
            return "（原始文件不存在或已清理）"
        try:
            with open(doc.storage_path, encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except OSError:
            return "（文件读取失败）"
        start = max(0, offset - 1)
        page = lines[start : start + max(1, min(limit, 500))]
        if not page:
            return f"（超出范围：全文共 {len(lines)} 行）"
        body = "".join(f"{start + i + 1:>5}\t{ln}" for i, ln in enumerate(page))
        return f"{doc.filename} · 第 {start + 1}-{start + len(page)} 行 / 共 {len(lines)} 行\n{body}"

    @mcp.tool(description="按 chunk_id 读取该信源中某个分块的完整原文（引用溯源）。")
    async def get_chunk(chunk_id: str) -> str:
        scope = _require_scope()
        cid = (chunk_id or "").strip()
        if not cid:
            return "（缺少 chunk_id）"
        chunk = await scope.engine_manager.get_chunk(
            scope.source.sag_source_config_id, cid, source=scope.source
        )
        if chunk is None:
            return "（未找到该分块）"
        heading = (chunk.heading or "").strip()
        return f"{heading}\n\n{chunk.content}".strip() if heading else chunk.content

    return mcp


# 进程内复用的单例（HTTP 挂载与 agent 客户端可共享同一个 server 定义）。
_singleton: FastMCP | None = None


def get_source_mcp() -> FastMCP:
    global _singleton
    if _singleton is None:
        _singleton = build_source_mcp()
    return _singleton


async def serve_stdio(source_id: str) -> None:
    """stdio 入口：`SAG_MCP_SOURCE_ID=<id> python -m sag_api.mcp.server`。

    面向只支持 stdio 的宿主（部分 Claude Desktop 配置）。整个进程服务单一信源：
    启动时构造暖引擎 + 载入 Source，设好作用域后运行 stdio server。
    """
    from sqlalchemy import select

    from sag_api.core.config import settings
    from sag_api.core.db import SessionLocal
    from sag_api.db.models import Source
    from sag_api.sag import EngineManager

    engine_manager = EngineManager(settings)
    async with SessionLocal() as session:
        source = (
            await session.execute(select(Source).where(Source.id == source_id))
        ).scalar_one_or_none()
    if source is None:
        raise SystemExit(f"信源不存在：{source_id}")

    mcp = get_source_mcp()
    try:
        with use_scope(engine_manager, source):
            await mcp.run_stdio_async()
    finally:
        await engine_manager.aclose_all()


def _main() -> None:
    import asyncio
    import os

    source_id = os.environ.get("SAG_MCP_SOURCE_ID", "").strip()
    if not source_id:
        raise SystemExit("请设置 SAG_MCP_SOURCE_ID=<信源 id>")
    asyncio.run(serve_stdio(source_id))


if __name__ == "__main__":
    _main()
