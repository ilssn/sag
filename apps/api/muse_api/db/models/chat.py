from __future__ import annotations

from sqlalchemy import Enum as SAEnum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from muse_api.db.base import Base, IDMixin, TimestampMixin
from muse_api.enums import MessageRole


class ChatThread(IDMixin, TimestampMixin, Base):
    __tablename__ = "chat_threads"

    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), default="新会话")


class ChatMessage(IDMixin, TimestampMixin, Base):
    __tablename__ = "chat_messages"

    thread_id: Mapped[str] = mapped_column(
        ForeignKey("chat_threads.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MessageRole] = mapped_column(SAEnum(MessageRole, native_enum=False, length=16))
    content: Mapped[str] = mapped_column(Text, default="")
    # 引用来源快照：[{n, section_id, heading, snippet, score, document_id?}]
    citations: Mapped[list] = mapped_column("citations_json", JSON, default=list)
