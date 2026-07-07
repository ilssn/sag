"""问答会话领域逻辑：检索 → 组装 → （由路由层）流式生成。

为规避「请求级会话在流式响应期间已关闭」的问题，本模块把一次问答拆成两步：
- `prepare_ask`：用请求会话完成落库用户消息 + 检索 + 组装提示词。
- `persist_answer`：在流式生成结束后，用**独立会话**落库助手消息。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from muse_api.core.config import settings
from muse_api.core.errors import NotFoundError
from muse_api.db.models import ChatMessage, ChatThread, Source
from muse_api.enums import MessageRole
from muse_api.generation import build_citations, build_messages
from muse_api.sag import EngineManager

_DEFAULT_TITLES = {"新会话", "New chat"}
_HISTORY_LIMIT = 6


async def list_threads(session: AsyncSession, source_id: str) -> list[ChatThread]:
    rows = await session.execute(
        select(ChatThread).where(ChatThread.source_id == source_id).order_by(ChatThread.updated_at.desc())
    )
    return list(rows.scalars().all())


async def create_thread(
    session: AsyncSession, source: Source, user_id: str, title: str = "新会话"
) -> ChatThread:
    thread = ChatThread(source_id=source.id, user_id=user_id, title=title or "新会话")
    session.add(thread)
    await session.commit()
    await session.refresh(thread)
    return thread


async def get_thread(session: AsyncSession, source_id: str, thread_id: str) -> ChatThread:
    thread = await session.get(ChatThread, thread_id)
    if thread is None or thread.source_id != source_id:
        raise NotFoundError("会话不存在")
    return thread


async def list_messages(session: AsyncSession, thread_id: str) -> list[ChatMessage]:
    rows = await session.execute(
        select(ChatMessage).where(ChatMessage.thread_id == thread_id).order_by(ChatMessage.created_at)
    )
    return list(rows.scalars().all())


async def delete_thread(session: AsyncSession, source_id: str, thread_id: str) -> None:
    thread = await get_thread(session, source_id, thread_id)
    await session.delete(thread)
    await session.commit()


def _language(source: Source) -> str:
    engine_cfg = (source.config or {}).get("engine") or {}
    return engine_cfg.get("language") or settings.sag_language


async def _history(session: AsyncSession, thread_id: str, exclude_id: str) -> list[dict[str, str]]:
    messages = await list_messages(session, thread_id)
    history = [
        {"role": m.role.value, "content": m.content}
        for m in messages
        if m.id != exclude_id and m.role in (MessageRole.USER, MessageRole.ASSISTANT)
    ]
    return history[-_HISTORY_LIMIT:]


async def prepare_ask(
    session: AsyncSession,
    *,
    source: Source,
    thread: ChatThread,
    query: str,
    engine_manager: EngineManager,
    strategy: str | None = None,
    top_k: int | None = None,
) -> tuple[list[dict[str, str]], list[dict]]:
    """落库用户消息、检索、组装提示词。返回 (messages, citations)。"""
    user_msg = ChatMessage(thread_id=thread.id, role=MessageRole.USER, content=query, citations=[])
    session.add(user_msg)
    if thread.title in _DEFAULT_TITLES:
        thread.title = query[:40]
    await session.commit()
    await session.refresh(user_msg)

    outcome = await engine_manager.search(
        source.sag_source_config_id, query, source=source, strategy=strategy, top_k=top_k
    )
    citations = build_citations(outcome.sections)
    history = await _history(session, thread.id, exclude_id=user_msg.id)
    messages = build_messages(
        query, outcome.sections, history=history, language=_language(source)
    )
    return messages, citations


async def persist_answer(
    session_factory: async_sessionmaker,
    thread_id: str,
    answer: str,
    citations: list[dict],
) -> str:
    async with session_factory() as session:
        message = ChatMessage(
            thread_id=thread_id,
            role=MessageRole.ASSISTANT,
            content=answer,
            citations=citations,
        )
        session.add(message)
        await session.commit()
        await session.refresh(message)
        return message.id
