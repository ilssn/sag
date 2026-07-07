"""FastAPI 依赖：认证、工作空间、应用级单例。"""

from __future__ import annotations

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.core.db import get_session
from muse_api.core.errors import AuthError
from muse_api.core.security import decode_token
from muse_api.db.models import User
from muse_api.generation import LLMClient
from muse_api.jobs import JobQueue
from muse_api.sag import EngineManager
from muse_api.services.auth_service import default_workspace_id, get_user

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
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
    return user


async def get_workspace_id(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> str:
    return await default_workspace_id(session, user.id)


def get_engine_manager(request: Request) -> EngineManager:
    return request.app.state.engine_manager


def get_job_queue(request: Request) -> JobQueue:
    return request.app.state.job_queue


def get_llm(request: Request) -> LLMClient:
    return request.app.state.llm
