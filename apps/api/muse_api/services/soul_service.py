"""灵魂领域逻辑：CRUD、绑定、上下文解析、多源 fan-out 对话。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from muse_api.core.config import settings
from muse_api.core.errors import ConflictError, NotFoundError, ValidationError
from muse_api.core.logging import get_logger
from muse_api.db.base import new_id
from muse_api.db.models import Namespace, Soul, SoulBinding, SoulMessage, SoulThread, Source
from muse_api.enums import (
    BindingTargetType,
    ConnectorKind,
    MessageRole,
    NamespaceKind,
    SoulOrigin,
    SourceType,
)
from muse_api.generation import build_citations, build_soul_messages
from muse_api.sag import EngineManager
from muse_api.services.namespace_service import default_namespace

log = get_logger("services.soul")

_DEFAULT_TITLES = {"新会话", "New chat"}
_HISTORY_LIMIT = 6


# ── CRUD ────────────────────────────────────────────────────────────
async def list_souls(session: AsyncSession, workspace_id: str) -> list[Soul]:
    rows = await session.execute(
        select(Soul).where(Soul.workspace_id == workspace_id).order_by(Soul.created_at.desc())
    )
    return list(rows.scalars().all())


async def get_soul(session: AsyncSession, workspace_id: str, soul_id: str) -> Soul:
    soul = await session.get(Soul, soul_id)
    if soul is None or soul.workspace_id != workspace_id:
        raise NotFoundError("Agent 不存在")
    return soul


async def create_soul(
    session: AsyncSession,
    workspace_id: str,
    *,
    name: str,
    avatar: str = "",
    persona: dict | None = None,
    origin: SoulOrigin = SoulOrigin.USER,
    origin_ref: dict | None = None,
) -> Soul:
    name = name.strip()
    if not name:
        raise ValidationError("Agent 名称不能为空")
    memory_ns = await default_namespace(session, workspace_id, NamespaceKind.MEMORY)
    soul = Soul(
        workspace_id=workspace_id,
        name=name,
        avatar=avatar or name[:1],
        persona=persona or {},
        origin=origin,
        origin_ref=origin_ref or {},
        memory_namespace_id=memory_ns.id,
    )
    session.add(soul)
    await session.commit()
    await session.refresh(soul)
    return soul


async def update_soul(
    session: AsyncSession,
    workspace_id: str,
    soul_id: str,
    *,
    name: str | None = None,
    avatar: str | None = None,
    persona: dict | None = None,
) -> Soul:
    soul = await get_soul(session, workspace_id, soul_id)
    if name is not None:
        soul.name = name
    if avatar is not None:
        soul.avatar = avatar
    if persona is not None:
        soul.persona = persona
    await session.commit()
    await session.refresh(soul)
    return soul


async def delete_soul(session: AsyncSession, workspace_id: str, soul_id: str) -> None:
    soul = await get_soul(session, workspace_id, soul_id)
    await session.delete(soul)
    await session.commit()


# ── 绑定 ────────────────────────────────────────────────────────────
async def list_bindings(session: AsyncSession, soul: Soul) -> list[SoulBinding]:
    rows = await session.execute(select(SoulBinding).where(SoulBinding.soul_id == soul.id))
    return list(rows.scalars().all())


async def add_binding(
    session: AsyncSession,
    workspace_id: str,
    soul: Soul,
    *,
    target_type: BindingTargetType,
    target_id: str,
) -> SoulBinding:
    # 校验目标归属工作空间
    if target_type == BindingTargetType.NAMESPACE:
        ns = await session.get(Namespace, target_id)
        if ns is None or ns.workspace_id != workspace_id:
            raise NotFoundError("分组不存在")
    else:
        src = await session.get(Source, target_id)
        if src is None or src.workspace_id != workspace_id:
            raise NotFoundError("知识库不存在")
    exists = await session.scalar(
        select(SoulBinding).where(
            SoulBinding.soul_id == soul.id,
            SoulBinding.target_type == target_type,
            SoulBinding.target_id == target_id,
        )
    )
    if exists is not None:
        raise ConflictError("已绑定该目标")
    binding = SoulBinding(soul_id=soul.id, target_type=target_type, target_id=target_id)
    session.add(binding)
    await session.commit()
    await session.refresh(binding)
    return binding


async def remove_binding(session: AsyncSession, soul: Soul, binding_id: str) -> None:
    binding = await session.get(SoulBinding, binding_id)
    if binding is None or binding.soul_id != soul.id:
        raise NotFoundError("绑定不存在")
    await session.delete(binding)
    await session.commit()


async def resolve_sources(session: AsyncSession, soul: Soul) -> list[Source]:
    """展开绑定 → 去重后的信源列表（命名空间 → 其下全部信源）。"""
    bindings = await list_bindings(session, soul)
    ns_ids = [b.target_id for b in bindings if b.target_type == BindingTargetType.NAMESPACE]
    src_ids = [b.target_id for b in bindings if b.target_type == BindingTargetType.SOURCE]
    found: dict[str, Source] = {}
    if ns_ids:
        rows = await session.execute(select(Source).where(Source.namespace_id.in_(ns_ids)))
        for s in rows.scalars():
            found[s.id] = s
    if src_ids:
        rows = await session.execute(select(Source).where(Source.id.in_(src_ids)))
        for s in rows.scalars():
            found[s.id] = s
    # 灵魂自己的会话记忆（越聊越懂你）
    mem = await session.execute(
        select(Source).where(
            Source.soul_id == soul.id, Source.source_type == SourceType.CONVERSATION
        )
    )
    for s in mem.scalars():
        found[s.id] = s
    return list(found.values())


async def remember_exchange(
    session_factory,
    job_queue,
    *,
    soul_id: str,
    thread_id: str,
    question: str,
    answer: str,
    upload_dir: str,
) -> None:
    """把一轮问答写入该灵魂/会话的记忆信源（懒创建）→ 入队 ingest/extract，形成记忆闭环。"""
    from muse_api.services.document_service import create_document_from_upload

    if not answer.strip():
        return
    async with session_factory() as session:
        soul = await session.get(Soul, soul_id)
        thread = await session.get(SoulThread, thread_id)
        if soul is None or thread is None or not soul.memory_namespace_id:
            return
        src = await session.get(Source, thread.memory_source_id) if thread.memory_source_id else None
        if src is None:
            src = Source(
                workspace_id=soul.workspace_id,
                namespace_id=soul.memory_namespace_id,
                soul_id=soul.id,
                name=f"与 {soul.name} 的对话",
                source_type=SourceType.CONVERSATION,
                connector_kind=ConnectorKind.FILE_UPLOAD,
                sag_source_config_id=f"mem_{new_id()[:16]}",
                config={},
            )
            session.add(src)
            await session.flush()
            thread.memory_source_id = src.id
            await session.commit()
            await session.refresh(src)
        md = f"# 对话记忆\n\n**用户**：{question}\n\n**{soul.name}**：{answer}\n".encode()
        await create_document_from_upload(
            session,
            src,
            filename="exchange.md",
            content_type="text/markdown",
            data=md,
            upload_dir=upload_dir,
            job_queue=job_queue,
        )
        log.info("记忆写入 soul=%s thread=%s source=%s", soul.id, thread.id, src.id)


# ── 会话 ────────────────────────────────────────────────────────────
async def list_threads(session: AsyncSession, soul_id: str) -> list[SoulThread]:
    rows = await session.execute(
        select(SoulThread).where(SoulThread.soul_id == soul_id).order_by(SoulThread.updated_at.desc())
    )
    return list(rows.scalars().all())


async def create_thread(
    session: AsyncSession, soul: Soul, user_id: str, title: str = "新会话"
) -> SoulThread:
    thread = SoulThread(soul_id=soul.id, user_id=user_id, title=title or "新会话")
    session.add(thread)
    await session.commit()
    await session.refresh(thread)
    return thread


async def get_thread(session: AsyncSession, soul_id: str, thread_id: str) -> SoulThread:
    thread = await session.get(SoulThread, thread_id)
    if thread is None or thread.soul_id != soul_id:
        raise NotFoundError("会话不存在")
    return thread


async def delete_thread(session: AsyncSession, soul_id: str, thread_id: str) -> None:
    thread = await get_thread(session, soul_id, thread_id)
    await session.delete(thread)
    await session.commit()


async def list_messages(session: AsyncSession, thread_id: str) -> list[SoulMessage]:
    rows = await session.execute(
        select(SoulMessage).where(SoulMessage.thread_id == thread_id).order_by(SoulMessage.created_at)
    )
    return list(rows.scalars().all())


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
    soul: Soul,
    thread: SoulThread,
    query: str,
    engine_manager: EngineManager,
    author: str | None = None,
) -> tuple[list[dict[str, str]], list[dict]]:
    """落库用户消息、跨绑定上下文 fan-out 检索、组装带人格的提示词。"""
    user_msg = SoulMessage(
        thread_id=thread.id, role=MessageRole.USER, content=query, author=author, citations=[]
    )
    session.add(user_msg)
    if thread.title in _DEFAULT_TITLES:
        thread.title = query[:40]
    await session.commit()
    await session.refresh(user_msg)

    persona = soul.persona or {}
    sources = await resolve_sources(session, soul)
    source_names = {s.sag_source_config_id: s.name for s in sources}
    if sources:
        targets = [(s.sag_source_config_id, s) for s in sources]
        outcome = await engine_manager.search_many(
            targets,
            query,
            strategy=persona.get("search_strategy"),
            top_k=persona.get("top_k"),
        )
        sections = outcome.sections
    else:
        sections = []

    citations = build_citations(sections, source_names)
    history = await _history(session, thread.id, exclude_id=user_msg.id)
    messages = build_soul_messages(
        soul.name, persona, query, sections, history=history, language=settings.sag_language
    )
    return messages, citations


async def persist_answer(
    session_factory: async_sessionmaker, thread_id: str, answer: str, citations: list[dict]
) -> str:
    async with session_factory() as session:
        message = SoulMessage(
            thread_id=thread_id, role=MessageRole.ASSISTANT, content=answer, citations=citations
        )
        session.add(message)
        await session.commit()
        await session.refresh(message)
        return message.id
