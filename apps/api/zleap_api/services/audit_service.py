"""审计记录——在关键动作后写入只增日志。

设计原则：审计永不破坏主流程，也不与主动作共享事务。审计写入使用**独立会话**：
这样即便主动作刚刚删除了对象、或其会话处于提交后状态，也不会相互污染；
一次审计失败只记日志、绝不让用户的正常操作回滚或报错。
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import SessionLocal
from zleap_api.core.logging import get_logger
from zleap_api.db.models import AuditLog, User
from zleap_api.enums import AuditAction

log = get_logger("audit")


def client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    # 反向代理场景优先取 X-Forwarded-For 首段
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


async def record(
    *,
    workspace_id: str,
    action: AuditAction,
    actor: User | None = None,
    actor_id: str | None = None,
    actor_email: str = "",
    target_type: str = "",
    target_id: str = "",
    target_label: str = "",
    meta: dict[str, Any] | None = None,
    ip: str = "",
) -> None:
    """在独立会话中写一条审计并提交；异常只记日志，不外抛。"""
    if actor is not None:
        actor_id = actor.id
        actor_email = actor.email
    try:
        async with SessionLocal() as session:
            session.add(
                AuditLog(
                    workspace_id=workspace_id,
                    actor_id=actor_id,
                    actor_email=actor_email or "",
                    action=str(action),
                    target_type=target_type,
                    target_id=target_id,
                    target_label=(target_label or "")[:255],
                    meta_json=json.dumps(meta, ensure_ascii=False) if meta else "",
                    ip=ip,
                )
            )
            await session.commit()
    except Exception as e:  # noqa: BLE001 —— 审计不可影响主流程
        log.warning("审计写入失败 action=%s: %s", action, e)


async def record_request(
    request: Request,
    action: AuditAction,
    *,
    workspace_id: str | None = None,
    target_type: str = "",
    target_id: str = "",
    target_label: str = "",
    meta: dict[str, Any] | None = None,
) -> None:
    """从请求上下文（actor=request.state.user，ip，活动空间）记录一条审计。"""
    actor: User | None = getattr(request.state, "user", None)
    if workspace_id is None:
        membership = getattr(request.state, "membership", None)
        workspace_id = membership.workspace_id if membership is not None else ""
    await record(
        workspace_id=workspace_id or "",
        action=action,
        actor=actor,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        meta=meta,
        ip=client_ip(request),
    )


async def list_audit(
    session: AsyncSession,
    workspace_id: str,
    *,
    action: str | None = None,
    actor_email: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AuditLog], int]:
    """按空间倒序读取审计（可选按动作 / 操作者邮箱过滤），返回 (页数据, 总数)。"""
    where = [AuditLog.workspace_id == workspace_id]
    if action:
        where.append(AuditLog.action == action)
    if actor_email:
        where.append(AuditLog.actor_email.ilike(f"%{actor_email.strip().lower()}%"))
    total = await session.scalar(
        select(func.count()).select_from(AuditLog).where(*where)
    )
    rows = await session.execute(
        select(AuditLog)
        .where(*where)
        .order_by(AuditLog.created_at.desc())
        .limit(min(limit, 500))
        .offset(offset)
    )
    return list(rows.scalars().all()), int(total or 0)
