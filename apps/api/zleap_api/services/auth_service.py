"""认证与用户 / 工作空间领域逻辑。"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.errors import AuthError, ConflictError, ForbiddenError, NotFoundError
from zleap_api.core.security import hash_password, verify_password
from zleap_api.db.base import new_id
from zleap_api.db.models import Membership, User, Workspace
from zleap_api.enums import UserRole, WorkspaceRole


async def register_user(session: AsyncSession, *, email: str, password: str, name: str = "") -> User:
    from zleap_api.core.config import settings

    existing = await session.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ConflictError("该邮箱已注册")

    # 首个注册用户成为管理员；注册关闭时仅放行首个用户（部署引导）
    user_count = await session.scalar(select(func.count()).select_from(User)) or 0
    if user_count > 0 and not settings.allow_registration:
        raise ForbiddenError("注册已关闭，请联系管理员开通账号")
    role = UserRole.ADMIN if user_count == 0 else UserRole.MEMBER

    user = User(
        email=email,
        password_hash=hash_password(password),
        name=name or email.split("@")[0],
        role=role,
    )
    session.add(user)
    await session.flush()

    workspace = Workspace(
        name=f"{user.name} 的空间",
        slug=f"ws-{new_id()[:12]}",
        owner_id=user.id,
    )
    session.add(workspace)
    await session.flush()
    session.add(Membership(user_id=user.id, workspace_id=workspace.id, role=WorkspaceRole.OWNER))

    await session.commit()

    # 默认命名空间：会话记忆 + 知识
    from zleap_api.services.namespace_service import ensure_default_namespaces

    await ensure_default_namespaces(session, workspace.id)

    await session.refresh(user)
    return user


async def authenticate(session: AsyncSession, *, email: str, password: str) -> User:
    user = await session.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError("邮箱或密码错误")
    if not user.is_active:
        raise ForbiddenError("账号已停用")
    return user


async def get_user(session: AsyncSession, user_id: str) -> User | None:
    return await session.get(User, user_id)


async def default_workspace_id(session: AsyncSession, user_id: str) -> str:
    ws_id = await session.scalar(
        select(Membership.workspace_id)
        .where(Membership.user_id == user_id)
        .order_by(Membership.created_at)
        .limit(1)
    )
    if ws_id is None:
        raise NotFoundError("无可用工作空间")
    return ws_id
