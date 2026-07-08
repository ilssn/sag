from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from zleap_api.db.base import Base, IDMixin


class AuditLog(IDMixin, Base):
    """审计日志——只增不改。actor 邮箱快照，即使用户后续改名/离开空间仍可追溯。"""

    __tablename__ = "audit_logs"

    workspace_id: Mapped[str] = mapped_column(String(32), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    actor_email: Mapped[str] = mapped_column(String(255), default="")
    action: Mapped[str] = mapped_column(String(48), index=True)
    target_type: Mapped[str] = mapped_column(String(32), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    target_label: Mapped[str] = mapped_column(String(255), default="")
    meta_json: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
