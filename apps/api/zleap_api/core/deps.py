"""FastAPI 依赖：认证 + 应用级单例。单用户，无工作空间/角色。"""

from __future__ import annotations

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.errors import AuthError
from zleap_api.core.security import decode_token
from zleap_api.db.models import User
from zleap_api.generation import LLMClient
from zleap_api.jobs import JobQueue
from zleap_api.sag import EngineManager
from zleap_api.services.auth_service import get_user

_bearer = HTTPBearer(auto_error=False)


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


def get_engine_manager(request: Request) -> EngineManager:
    return request.app.state.engine_manager


def get_job_queue(request: Request) -> JobQueue:
    return request.app.state.job_queue


def get_llm(request: Request) -> LLMClient:
    return request.app.state.llm


def get_tool_registry():
    """Agent 工具注册表（内置检索/实体工具 + 运行时注入的 MCP 工具）。"""
    from zleap_api.tools import registry

    return registry
