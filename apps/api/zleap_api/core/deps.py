"""FastAPI 依赖：认证、工作空间（多空间切换 + 角色）、应用级单例。

多空间语义：请求可带 `X-Workspace-Id` 指定活动空间（必须是成员，否则 403）；
缺省回退到用户最早加入的空间。角色门：`require_editor`（editor/owner）、
`require_owner`（仅 owner）。同一请求内 membership 只查一次（挂在 request.state）。
"""

from __future__ import annotations

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.errors import AuthError, ForbiddenError
from zleap_api.core.security import decode_token
from zleap_api.db.models import Membership, User
from zleap_api.enums import WorkspaceRole
from zleap_api.generation import LLMClient
from zleap_api.jobs import JobQueue
from zleap_api.sag import EngineManager
from zleap_api.services.auth_service import default_workspace_id, get_user

_bearer = HTTPBearer(auto_error=False)

WORKSPACE_HEADER = "X-Workspace-Id"


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if creds is None:
        raise AuthError("缺少认证令牌")
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError as e:
        raise AuthError("令牌无效或已过期") from e
    user_id = payload.get("sub")
    user = await get_user(session, user_id) if user_id else None
    if user is None or not user.is_active:
        raise AuthError("用户不存在或已停用")
    request.state.user = user
    return user


async def get_membership(
    request: Request,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Membership:
    """解析活动空间的成员关系（header 指定或默认空间）；非成员 → 403。"""
    cached = getattr(request.state, "membership", None)
    if cached is not None:
        return cached

    ws_id = request.headers.get(WORKSPACE_HEADER) or await default_workspace_id(session, user.id)
    membership = await session.scalar(
        select(Membership).where(Membership.user_id == user.id, Membership.workspace_id == ws_id)
    )
    if membership is None:
        raise ForbiddenError("你不是该空间的成员")
    request.state.membership = membership
    return membership


async def get_workspace_id(membership: Membership = Depends(get_membership)) -> str:
    return membership.workspace_id


async def get_workspace_role(membership: Membership = Depends(get_membership)) -> WorkspaceRole:
    return membership.role


async def require_editor(membership: Membership = Depends(get_membership)) -> Membership:
    """内容写操作门：viewer 只读。"""
    if membership.role == WorkspaceRole.VIEWER:
        raise ForbiddenError("只读成员无法执行此操作")
    return membership


async def require_owner(membership: Membership = Depends(get_membership)) -> Membership:
    """空间管理门：仅 owner。"""
    if membership.role != WorkspaceRole.OWNER:
        raise ForbiddenError("仅空间所有者可执行此操作")
    return membership


def get_engine_manager(request: Request) -> EngineManager:
    return request.app.state.engine_manager


def get_job_queue(request: Request) -> JobQueue:
    return request.app.state.job_queue


def get_llm(request: Request) -> LLMClient:
    return request.app.state.llm
