"""灵魂领域逻辑：CRUD、绑定、上下文解析、多源 fan-out 对话。"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from zleap_api.core.config import settings
from zleap_api.core.errors import ConflictError, ForbiddenError, NotFoundError, ValidationError
from zleap_api.core.logging import get_logger
from zleap_api.db.base import new_id
from zleap_api.db.models import Namespace, Soul, SoulBinding, SoulMessage, SoulThread, Source
from zleap_api.enums import (
    BindingTargetType,
    ConnectorKind,
    MessageRole,
    NamespaceKind,
    SoulOrigin,
    SoulVisibility,
    SourceType,
    WorkspaceRole,
)
from zleap_api.generation import build_citations, build_prompt_preview, build_soul_messages
from zleap_api.sag import EngineManager
from zleap_api.services.namespace_service import default_namespace

log = get_logger("services.soul")

_DEFAULT_TITLES = {"新会话", "New chat"}
_HISTORY_LIMIT = 6


# ── 访问语义 ─────────────────────────────────────────────────────────
def _accessible(soul: Soul, user_id: str, role: WorkspaceRole) -> bool:
    """可见：空间共享 / 我创建的 / 我是空间 owner（含 owner_id 为空的存量数据）。"""
    return (
        soul.visibility == SoulVisibility.WORKSPACE
        or soul.owner_id == user_id
        or soul.owner_id is None
        or role == WorkspaceRole.OWNER
    )


def _manageable(soul: Soul, user_id: str, role: WorkspaceRole) -> bool:
    """可管（改设定/可见性/删除/绑定）：创建者或空间 owner。"""
    return soul.owner_id == user_id or soul.owner_id is None or role == WorkspaceRole.OWNER


def ensure_manageable(soul: Soul, user_id: str, role: WorkspaceRole) -> None:
    if not _manageable(soul, user_id, role):
        raise ForbiddenError("仅创建者或空间所有者可管理该助手")


# ── CRUD ────────────────────────────────────────────────────────────
async def list_souls(
    session: AsyncSession, workspace_id: str, *, user_id: str, role: WorkspaceRole
) -> list[Soul]:
    stmt = select(Soul).where(Soul.workspace_id == workspace_id)
    if role != WorkspaceRole.OWNER:
        stmt = stmt.where(
            (Soul.visibility == SoulVisibility.WORKSPACE)
            | (Soul.owner_id == user_id)
            | (Soul.owner_id.is_(None))
        )
    rows = await session.execute(stmt.order_by(Soul.created_at.desc()))
    return list(rows.scalars().all())


async def get_soul(
    session: AsyncSession, workspace_id: str, soul_id: str, *, user_id: str, role: WorkspaceRole
) -> Soul:
    soul = await session.get(Soul, soul_id)
    if soul is None or soul.workspace_id != workspace_id or not _accessible(soul, user_id, role):
        raise NotFoundError("助手不存在")
    return soul


async def create_soul(
    session: AsyncSession,
    workspace_id: str,
    *,
    name: str,
    owner_id: str,
    avatar: str = "",
    persona: dict | None = None,
    visibility: SoulVisibility = SoulVisibility.PRIVATE,
    origin: SoulOrigin = SoulOrigin.USER,
    origin_ref: dict | None = None,
) -> Soul:
    name = name.strip()
    if not name:
        raise ValidationError("助手名称不能为空")
    memory_ns = await default_namespace(session, workspace_id, NamespaceKind.MEMORY)
    soul = Soul(
        workspace_id=workspace_id,
        owner_id=owner_id,
        visibility=visibility,
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
    user_id: str,
    role: WorkspaceRole,
    name: str | None = None,
    avatar: str | None = None,
    persona: dict | None = None,
    visibility: SoulVisibility | None = None,
) -> Soul:
    soul = await get_soul(session, workspace_id, soul_id, user_id=user_id, role=role)
    ensure_manageable(soul, user_id, role)
    if visibility is not None:
        soul.visibility = visibility
    if name is not None:
        soul.name = name
    if avatar is not None:
        soul.avatar = avatar
    if persona is not None:
        soul.persona = persona
    await session.commit()
    await session.refresh(soul)
    return soul


async def delete_soul(
    session: AsyncSession, workspace_id: str, soul_id: str, *, user_id: str, role: WorkspaceRole
) -> None:
    soul = await get_soul(session, workspace_id, soul_id, user_id=user_id, role=role)
    ensure_manageable(soul, user_id, role)
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
            raise NotFoundError("信源不存在")
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
    from zleap_api.services.document_service import create_document_from_upload

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


async def _memory_sources(session: AsyncSession, soul: Soul) -> list[Source]:
    rows = await session.execute(
        select(Source).where(
            Source.soul_id == soul.id, Source.source_type == SourceType.CONVERSATION
        )
    )
    return list(rows.scalars().all())


async def memory_stats(session: AsyncSession, soul: Soul) -> dict:
    """助手记忆概况：沉淀的对话条数、分块与事件数、最近若干条。"""
    from zleap_api.db.models import Document

    srcs = await _memory_sources(session, soul)
    src_ids = [s.id for s in srcs]
    docs: list = []
    if src_ids:
        rows = await session.execute(
            select(Document)
            .where(Document.source_id.in_(src_ids))
            .order_by(Document.created_at.desc())
        )
        docs = list(rows.scalars().all())
    return {
        "document_count": len(docs),
        "chunk_count": sum(d.chunk_count for d in docs),
        "event_count": sum(d.event_count for d in docs),
        "recent": [
            {"id": d.id, "status": str(d.status), "created_at": d.created_at} for d in docs[:12]
        ],
    }


async def clear_memory(
    session: AsyncSession, soul: Soul, *, engine_manager: EngineManager, upload_dir: str
) -> int:
    """清空助手的会话记忆：删除记忆信源（含引擎槽与落盘文件），并解除会话引用。返回删除数。"""
    from zleap_api.services.source_service import delete_source

    srcs = await _memory_sources(session, soul)
    for s in srcs:
        # 解除引用该记忆源的会话，下一轮对话会重新懒创建
        await session.execute(
            SoulThread.__table__.update()
            .where(SoulThread.memory_source_id == s.id)
            .values(memory_source_id=None)
        )
        await session.commit()
        await delete_source(
            session,
            soul.workspace_id,
            s.id,
            engine_manager=engine_manager,
            upload_dir=upload_dir,
        )
    return len(srcs)


# ── 会话 ────────────────────────────────────────────────────────────
async def list_threads(session: AsyncSession, soul_id: str, *, user_id: str) -> list[SoulThread]:
    """会话按人隔离：共享助手下互相看不到彼此的会话。"""
    rows = await session.execute(
        select(SoulThread)
        .where(SoulThread.soul_id == soul_id, SoulThread.user_id == user_id)
        .order_by(SoulThread.updated_at.desc())
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


async def get_thread(
    session: AsyncSession, soul_id: str, thread_id: str, *, user_id: str
) -> SoulThread:
    thread = await session.get(SoulThread, thread_id)
    if thread is None or thread.soul_id != soul_id or thread.user_id != user_id:
        raise NotFoundError("会话不存在")
    return thread


async def delete_thread(
    session: AsyncSession, soul_id: str, thread_id: str, *, user_id: str
) -> None:
    thread = await get_thread(session, soul_id, thread_id, user_id=user_id)
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


@dataclass
class AskPlan:
    """一次问答的检索与提示词计划。"""

    messages: list[dict[str, str]] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    section_count: int = 0
    prompt_preview: str = ""
    # 检索为空且人格配置了兜底话术时，跳过 LLM 直接以此文案回复（防幻觉）
    short_circuit: str | None = None


async def build_ask_context(
    session: AsyncSession,
    *,
    soul: Soul,
    query: str,
    engine_manager: EngineManager,
    history: list[dict[str, str]] | None = None,
) -> AskPlan:
    """跨绑定上下文 fan-out 检索并组装带人格的提示词（不落库，可被对话与 OpenAI 端点复用）。"""
    persona = soul.persona or {}
    sources = await resolve_sources(session, soul)
    source_refs = {s.sag_source_config_id: {"id": s.id, "name": s.name} for s in sources}
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

    citations = build_citations(sections, source_refs)
    messages = build_soul_messages(
        soul.name, persona, query, sections, history=history, language=settings.sag_language
    )
    empty_response = (persona.get("empty_response") or "").strip()
    return AskPlan(
        messages=messages,
        citations=citations,
        section_count=len(sections),
        prompt_preview=build_prompt_preview(messages),
        short_circuit=empty_response if (not sections and empty_response) else None,
    )


async def prepare_ask(
    session: AsyncSession,
    *,
    soul: Soul,
    thread: SoulThread,
    query: str,
    engine_manager: EngineManager,
    author: str | None = None,
) -> AskPlan:
    """落库用户消息、解析历史，再委托 build_ask_context 组装计划。"""
    user_msg = SoulMessage(
        thread_id=thread.id, role=MessageRole.USER, content=query, author=author, citations=[]
    )
    session.add(user_msg)
    if thread.title in _DEFAULT_TITLES:
        thread.title = query[:40]
    await session.commit()
    await session.refresh(user_msg)

    history = await _history(session, thread.id, exclude_id=user_msg.id)
    return await build_ask_context(
        session, soul=soul, query=query, engine_manager=engine_manager, history=history
    )


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
