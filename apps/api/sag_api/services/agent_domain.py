"""Agent 领域逻辑：CRUD、绑定（信源/MCP）、上下文解析、多源 fan-out 对话。"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from sag_api.core.config import settings
from sag_api.core.errors import ConflictError, NotFoundError, ValidationError
from sag_api.db.models import Agent, AgentBinding, Message, Source, Thread
from sag_api.enums import BindingTargetType, MessageRole
from sag_api.generation import build_agent_messages, build_citations, build_prompt_preview
from sag_api.generation.prompt import estimate_tokens
from sag_api.sag import EngineManager

_DEFAULT_TITLES = {"新会话", "New chat"}


# ── CRUD ────────────────────────────────────────────────────────────
async def list_agents(session: AsyncSession) -> list[Agent]:
    rows = await session.execute(select(Agent).order_by(Agent.created_at.desc()))
    return list(rows.scalars().all())


async def get_agent(session: AsyncSession, agent_id: str) -> Agent:
    agent = await session.get(Agent, agent_id)
    if agent is None:
        raise NotFoundError("Agent 不存在")
    return agent


async def create_agent(
    session: AsyncSession, *, name: str, avatar: str = "", persona: dict | None = None
) -> Agent:
    name = name.strip()
    if not name:
        raise ValidationError("Agent 名称不能为空")
    agent = Agent(name=name, avatar=avatar or name[:1], persona=persona or {})
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


async def update_agent(
    session: AsyncSession,
    agent_id: str,
    *,
    name: str | None = None,
    avatar: str | None = None,
    persona: dict | None = None,
) -> Agent:
    agent = await get_agent(session, agent_id)
    if name is not None:
        agent.name = name
    if avatar is not None:
        agent.avatar = avatar
    if persona is not None:
        agent.persona = persona
    await session.commit()
    await session.refresh(agent)
    return agent


_DEFAULT_GREETING = "我在。上传资料到知识库，或直接问我任何问题。"


async def get_default_agent(session: AsyncSession) -> Agent:
    """默认 agent（开箱即用的主对话入口）：get-or-create，幂等。"""
    agent = await session.scalar(select(Agent).where(Agent.is_default.is_(True)))
    if agent is not None:
        return agent
    agent = Agent(
        name="sag",
        avatar="s",
        is_default=True,
        persona={"greeting": _DEFAULT_GREETING, "system_prompt": ""},
    )
    session.add(agent)
    await session.commit()
    await session.refresh(agent)
    return agent


async def delete_agent(session: AsyncSession, agent_id: str) -> None:
    agent = await get_agent(session, agent_id)
    await session.delete(agent)
    await session.commit()


# ── 绑定（信源 / MCP server）────────────────────────────────────────
async def list_bindings(session: AsyncSession, agent: Agent) -> list[AgentBinding]:
    rows = await session.execute(select(AgentBinding).where(AgentBinding.agent_id == agent.id))
    return list(rows.scalars().all())


async def add_binding(
    session: AsyncSession,
    agent: Agent,
    *,
    target_type: BindingTargetType,
    target_id: str,
    config: dict | None = None,
) -> AgentBinding:
    config = config or {}
    if target_type == BindingTargetType.SOURCE:
        if await session.get(Source, target_id) is None:
            raise NotFoundError("信源不存在")
    elif target_type == BindingTargetType.MCP_SERVER:
        if not (config.get("url") or config.get("command")):
            raise ValidationError("MCP server 需提供 url 或 command")
        target_id = target_id or (config.get("name") or config.get("url") or "mcp")
    exists = await session.scalar(
        select(AgentBinding).where(
            AgentBinding.agent_id == agent.id,
            AgentBinding.target_type == target_type,
            AgentBinding.target_id == target_id,
        )
    )
    if exists is not None:
        raise ConflictError("已绑定该目标")
    binding = AgentBinding(
        agent_id=agent.id, target_type=target_type, target_id=target_id, config=config
    )
    session.add(binding)
    await session.commit()
    await session.refresh(binding)
    return binding


async def remove_binding(session: AsyncSession, agent: Agent, binding_id: str) -> None:
    binding = await session.get(AgentBinding, binding_id)
    if binding is None or binding.agent_id != agent.id:
        raise NotFoundError("绑定不存在")
    await session.delete(binding)
    await session.commit()


async def resolve_sources(session: AsyncSession, agent: Agent) -> list[Source]:
    """展开信源绑定 → 去重后的信源列表。默认 agent 的知识库 = 全部信源。"""
    if agent.is_default:
        rows = await session.execute(select(Source).order_by(Source.created_at))
        return list(rows.scalars().all())
    bindings = await list_bindings(session, agent)
    src_ids = [b.target_id for b in bindings if b.target_type == BindingTargetType.SOURCE]
    if not src_ids:
        return []
    rows = await session.execute(select(Source).where(Source.id.in_(src_ids)))
    return list(rows.scalars().all())


async def resolve_mcp_specs(session: AsyncSession, agent: Agent) -> list[tuple[str, dict]]:
    """展开外部 MCP server 绑定 → `[(label, config), …]`，供 agent 作 MCP 客户端挂载。"""
    bindings = await list_bindings(session, agent)
    specs: list[tuple[str, dict]] = []
    for b in bindings:
        if b.target_type != BindingTargetType.MCP_SERVER:
            continue
        cfg = b.config or {}
        specs.append((cfg.get("name") or b.target_id or "mcp", cfg))
    return specs


# ── 会话 ────────────────────────────────────────────────────────────
async def list_threads(
    session: AsyncSession, agent_id: str, *, archived: bool = False
) -> list[Thread]:
    rows = await session.execute(
        select(Thread)
        .where(Thread.agent_id == agent_id, Thread.archived.is_(archived))
        .order_by(Thread.updated_at.desc())
    )
    return list(rows.scalars().all())


async def update_thread(
    session: AsyncSession,
    agent_id: str,
    thread_id: str,
    *,
    title: str | None = None,
    archived: bool | None = None,
) -> Thread:
    thread = await get_thread(session, agent_id, thread_id)
    if title is not None and title.strip():
        thread.title = title.strip()[:200]
    if archived is not None:
        thread.archived = archived
    await session.commit()
    await session.refresh(thread)
    return thread


async def create_thread(session: AsyncSession, agent: Agent, title: str = "新会话") -> Thread:
    thread = Thread(agent_id=agent.id, title=title or "新会话")
    session.add(thread)
    await session.commit()
    await session.refresh(thread)
    return thread


async def get_thread(session: AsyncSession, agent_id: str, thread_id: str) -> Thread:
    thread = await session.get(Thread, thread_id)
    if thread is None or thread.agent_id != agent_id:
        raise NotFoundError("会话不存在")
    return thread


async def delete_thread(session: AsyncSession, agent_id: str, thread_id: str) -> None:
    thread = await get_thread(session, agent_id, thread_id)
    await session.delete(thread)
    await session.commit()


async def list_messages(session: AsyncSession, thread_id: str) -> list[Message]:
    rows = await session.execute(
        select(Message).where(Message.thread_id == thread_id).order_by(Message.created_at)
    )
    return list(rows.scalars().all())


async def _history(session: AsyncSession, thread_id: str, exclude_id: str) -> list[dict[str, str]]:
    messages = await list_messages(session, thread_id)
    return [
        {"role": m.role.value, "content": m.content}
        for m in messages
        if m.id != exclude_id and m.role in (MessageRole.USER, MessageRole.ASSISTANT)
    ]


def _history_tokens(history: list[dict[str, str]]) -> int:
    return sum(estimate_tokens(m["content"]) for m in history)


async def compress_history(
    history: list[dict[str, str]], *, llm=None, budget_tokens: int
) -> list[dict[str, str]]:
    """上下文阈值压缩：超预算时把较早消息压成一段摘要，仅保留最近 N 条原文。

    有 LLM → 摘要旧段（保留事实/结论/称呼/待办）；无 LLM/失败 → 按预算从尾部裁剪。
    """
    if _history_tokens(history) <= budget_tokens:
        return history

    keep = max(2, settings.history_keep_recent)
    recent = history[-keep:]
    older = history[:-keep]
    if not older:
        return recent

    if llm is not None and getattr(llm, "configured", False):
        transcript = "\n".join(
            f"{'用户' if m['role'] == 'user' else '助手'}：{m['content']}" for m in older
        )[:12000]
        try:
            summary = await llm.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "把以下对话压缩为要点摘要（≤400字）："
                            "保留事实、结论、数字、人物称呼与未决事项；不要评论。"
                        ),
                    },
                    {"role": "user", "content": transcript},
                ]
            )
            return [
                {"role": "user", "content": f"（此前对话摘要，供参考）\n{summary.strip()}"},
                *recent,
            ]
        except Exception:  # noqa: BLE001
            pass

    # 兜底：从最近往前装，装满预算为止
    trimmed: list[dict[str, str]] = []
    used = 0
    for m in reversed(history):
        t = estimate_tokens(m["content"])
        if used + t > budget_tokens and trimmed:
            break
        trimmed.append(m)
        used += t
    return list(reversed(trimmed))


# ── 问答计划 ─────────────────────────────────────────────────────────
@dataclass
class AskPlan:
    """一次问答的检索与提示词计划。"""

    messages: list[dict[str, str]] = field(default_factory=list)
    citations: list[dict] = field(default_factory=list)
    section_count: int = 0
    prompt_preview: str = ""
    short_circuit: str | None = None  # 检索空 + 配置了兜底话术时跳过 LLM


async def build_ask_context(
    session: AsyncSession,
    *,
    agent: Agent,
    query: str,
    engine_manager: EngineManager,
    history: list[dict[str, str]] | None = None,
    attachments: list[dict] | None = None,
    source_ids: list[str] | None = None,
) -> AskPlan:
    """跨绑定信源 fan-out 检索并组装带系统提示的消息（不落库，对话与 OpenAI 端点复用）。"""
    persona = agent.persona or {}
    sources = await resolve_sources(session, agent)
    if source_ids:
        wanted = set(source_ids)
        sources = [s for s in sources if s.id in wanted]
    source_refs = {s.sag_source_config_id: {"id": s.id, "name": s.name} for s in sources}
    if sources:
        targets = [(s.sag_source_config_id, s) for s in sources]
        outcome = await engine_manager.search_many(
            targets, query, strategy=persona.get("search_strategy"), top_k=persona.get("top_k")
        )
        sections = outcome.sections
    else:
        sections = []

    citations = build_citations(sections, source_refs)
    messages = build_agent_messages(
        agent.name,
        persona,
        query,
        sections,
        history=history,
        language=settings.sag_language,
        attachments=attachments,
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
    agent: Agent,
    thread: Thread,
    query: str,
    engine_manager: EngineManager,
    attachments: list[str] | None = None,
    source_ids: list[str] | None = None,
    llm=None,
) -> AskPlan:
    """落库用户消息（含图片附件 meta）、解析历史（超上下文阈值时主动压缩），组装计划。"""
    from sag_api.api.v1.attachments import attachment_path

    resolved: list[dict] = []
    for aid in attachments or []:
        path = attachment_path(aid)
        if path is None:
            raise ValidationError(f"附件不存在或已过期：{aid}")
        ext = aid.rsplit(".", 1)[-1].lower()
        media_type = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                      "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/png")
        resolved.append({"id": aid, "media_type": media_type, "path": path})

    user_msg = Message(
        thread_id=thread.id,
        role=MessageRole.USER,
        content=query,
        citations=[],
        attachments=[{k: a[k] for k in ("id", "media_type")} for a in resolved],
    )
    session.add(user_msg)
    if thread.title in _DEFAULT_TITLES:
        thread.title = query[:40]
    await session.commit()
    await session.refresh(user_msg)

    history = await _history(session, thread.id, exclude_id=user_msg.id)
    # 历史预算 = 上下文窗口的 40%（其余留给资料区/工具轮/回答）
    history = await compress_history(
        history, llm=llm, budget_tokens=int(settings.llm_context_window * 0.4)
    )
    return await build_ask_context(
        session,
        agent=agent,
        query=query,
        engine_manager=engine_manager,
        history=history,
        attachments=resolved or None,
        source_ids=source_ids,
    )


async def delete_message(session: AsyncSession, agent_id: str, thread_id: str, message_id: str) -> None:
    thread = await get_thread(session, agent_id, thread_id)
    message = await session.get(Message, message_id)
    if message is None or message.thread_id != thread.id:
        raise NotFoundError("消息不存在")
    await session.delete(message)
    await session.commit()


async def persist_answer(
    session_factory: async_sessionmaker, thread_id: str, answer: str, citations: list[dict]
) -> str:
    async with session_factory() as session:
        message = Message(
            thread_id=thread_id, role=MessageRole.ASSISTANT, content=answer, citations=citations
        )
        session.add(message)
        await session.commit()
        await session.refresh(message)
        return message.id
