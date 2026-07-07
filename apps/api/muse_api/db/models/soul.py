from __future__ import annotations

from sqlalchemy import Enum as SAEnum, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from muse_api.db.base import Base, IDMixin, TimestampMixin
from muse_api.enums import BindingTargetType, MessageRole, SoulOrigin, SoulStatus


class Soul(IDMixin, TimestampMixin, Base):
    """灵魂 —— 名字 + 人格 + 绑定的上下文（+ 会话记忆）。"""

    __tablename__ = "souls"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    avatar: Mapped[str] = mapped_column(String(64), default="")  # emoji / 首字母 / url
    # 人格：{ system_prompt, greeting, voice, traits[], guardrails[], search_strategy, top_k, temperature }
    persona: Mapped[dict] = mapped_column("persona_json", JSON, default=dict)
    origin: Mapped[SoulOrigin] = mapped_column(
        SAEnum(SoulOrigin, native_enum=False, length=16), default=SoulOrigin.USER
    )
    origin_ref: Mapped[dict] = mapped_column("origin_ref_json", JSON, default=dict)
    # 该灵魂的「会话记忆」命名空间（创建时置为工作空间默认 memory 空间）
    memory_namespace_id: Mapped[str | None] = mapped_column(
        ForeignKey("namespaces.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[SoulStatus] = mapped_column(
        SAEnum(SoulStatus, native_enum=False, length=16), default=SoulStatus.ACTIVE
    )


class SoulBinding(IDMixin, TimestampMixin, Base):
    """灵魂能访问的上下文：命名空间或单个信源。"""

    __tablename__ = "soul_bindings"
    __table_args__ = (
        UniqueConstraint("soul_id", "target_type", "target_id", name="uq_soul_binding"),
    )

    soul_id: Mapped[str] = mapped_column(ForeignKey("souls.id", ondelete="CASCADE"), index=True)
    target_type: Mapped[BindingTargetType] = mapped_column(
        SAEnum(BindingTargetType, native_enum=False, length=16)
    )
    target_id: Mapped[str] = mapped_column(String(32), index=True)
    mode: Mapped[str] = mapped_column(String(16), default="read")


class SoulThread(IDMixin, TimestampMixin, Base):
    __tablename__ = "soul_threads"

    soul_id: Mapped[str] = mapped_column(ForeignKey("souls.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), default="新会话")
    # Phase 3：该会话沉淀成的 conversation 信源
    memory_source_id: Mapped[str | None] = mapped_column(String(32), nullable=True)


class SoulMessage(IDMixin, TimestampMixin, Base):
    __tablename__ = "soul_messages"

    thread_id: Mapped[str] = mapped_column(
        ForeignKey("soul_threads.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MessageRole] = mapped_column(SAEnum(MessageRole, native_enum=False, length=16))
    content: Mapped[str] = mapped_column(Text, default="")
    author: Mapped[str | None] = mapped_column(String(120), nullable=True)
    citations: Mapped[list] = mapped_column("citations_json", JSON, default=list)
