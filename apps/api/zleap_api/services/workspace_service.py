"""工作空间与成员领域逻辑（个人=1 人空间，公司=N 人空间，同一模型）。"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.errors import ConflictError, NotFoundError, ValidationError
from zleap_api.db.models import Membership, User, Workspace
from zleap_api.enums import WorkspaceRole


async def list_my_workspaces(session: AsyncSession, user_id: str) -> list[dict]:
    rows = await session.execute(
        select(Membership, Workspace)
        .join(Workspace, Workspace.id == Membership.workspace_id)
        .where(Membership.user_id == user_id)
        .order_by(Membership.created_at)
    )
    return [
        {"workspace_id": ws.id, "workspace_name": ws.name, "role": m.role}
        for m, ws in rows.all()
    ]


async def list_members(session: AsyncSession, workspace_id: str) -> list[dict]:
    rows = await session.execute(
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.workspace_id == workspace_id)
        .order_by(Membership.created_at)
    )
    return [
        {
            "user_id": u.id,
            "email": u.email,
            "name": u.name,
            "role": m.role,
            "joined_at": m.created_at,
        }
        for m, u in rows.all()
    ]


async def _owner_count(session: AsyncSession, workspace_id: str) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(
                Membership.workspace_id == workspace_id,
                Membership.role == WorkspaceRole.OWNER,
            )
        )
        or 0
    )


async def invite_member(
    session: AsyncSession,
    workspace_id: str,
    *,
    email: str,
    role: WorkspaceRole = WorkspaceRole.EDITOR,
) -> dict:
    """按邮箱邀请**已注册**用户加入空间（MVP 不发邮件）。"""
    email = email.strip().lower()
    user = await session.scalar(select(User).where(User.email == email))
    if user is None:
        raise NotFoundError("该邮箱尚未注册。请先让对方注册，再邀请。")
    exists = await session.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.workspace_id == workspace_id
        )
    )
    if exists is not None:
        raise ConflictError("对方已是本空间成员")
    if role == WorkspaceRole.OWNER:
        raise ValidationError("请先以成员身份加入，再由所有者转让/提升")
    m = Membership(user_id=user.id, workspace_id=workspace_id, role=role)
    session.add(m)
    await session.commit()
    return {"user_id": user.id, "email": user.email, "name": user.name, "role": role, "joined_at": m.created_at}


async def update_member_role(
    session: AsyncSession, workspace_id: str, member_user_id: str, *, role: WorkspaceRole
) -> dict:
    m = await session.scalar(
        select(Membership).where(
            Membership.user_id == member_user_id, Membership.workspace_id == workspace_id
        )
    )
    if m is None:
        raise NotFoundError("成员不存在")
    if m.role == WorkspaceRole.OWNER and role != WorkspaceRole.OWNER:
        if await _owner_count(session, workspace_id) <= 1:
            raise ValidationError("空间至少需要一名所有者")
    m.role = role
    await session.commit()
    user = await session.get(User, member_user_id)
    return {"user_id": user.id, "email": user.email, "name": user.name, "role": m.role, "joined_at": m.created_at}


async def remove_member(session: AsyncSession, workspace_id: str, member_user_id: str) -> None:
    m = await session.scalar(
        select(Membership).where(
            Membership.user_id == member_user_id, Membership.workspace_id == workspace_id
        )
    )
    if m is None:
        raise NotFoundError("成员不存在")
    if m.role == WorkspaceRole.OWNER and await _owner_count(session, workspace_id) <= 1:
        raise ValidationError("空间至少需要一名所有者，无法移除最后一名所有者")
    await session.delete(m)
    await session.commit()
