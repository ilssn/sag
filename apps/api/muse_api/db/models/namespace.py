from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from muse_api.db.base import Base, IDMixin, TimestampMixin
from muse_api.enums import NamespaceKind


class Namespace(IDMixin, TimestampMixin, Base):
    """命名空间 —— 信源的文件夹式分组。默认「会话记忆」与「知识」。"""

    __tablename__ = "namespaces"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_namespace_name"),)

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[NamespaceKind] = mapped_column(
        SAEnum(NamespaceKind, native_enum=False, length=16), default=NamespaceKind.CUSTOM
    )
    icon: Mapped[str] = mapped_column(String(32), default="")
    color: Mapped[str] = mapped_column(String(32), default="")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
