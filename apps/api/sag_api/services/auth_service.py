"""认证与用户领域逻辑（单用户）。"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.errors import AuthError, ConflictError, ForbiddenError
from sag_api.core.security import hash_password, verify_password
from sag_api.db.models import User


async def register_user(session: AsyncSession, *, email: str, password: str, name: str = "") -> User:
    from sag_api.core.config import settings

    existing = await session.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ConflictError("该邮箱已注册")

    # 个人向：首个注册即唯一账号；注册关闭时仅放行首个用户（部署引导）
    user_count = await session.scalar(select(func.count()).select_from(User)) or 0
    if user_count > 0 and not settings.allow_registration:
        raise ForbiddenError("注册已关闭")

    user = User(
        email=email,
        password_hash=hash_password(password),
        name=name or email.split("@")[0],
    )
    session.add(user)
    await session.commit()
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
