"""FastAPI 依赖：认证 + 应用级单例。单用户，无工作空间/角色。"""

from __future__ import annotations

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from sag_agent import AgentRuntime
from sag_api.core.db import get_session
from sag_api.core.errors import AuthError
from sag_api.core.security import decode_token
from sag_api.db.models import User
from sag_api.generation import LLMClient
from sag_api.jobs import JobQueue
from sag_api.sag import EngineManager
from sag_api.services.auth_service import get_user

_bearer = HTTPBearer(auto_error=False)


async def authenticate_bearer(session: AsyncSession, token: str) -> User:
    """统一的 Bearer 鉴权：本地访问密钥（ADR-0011）或 JWT。

    REST / MCP / openai-compat 共用本入口，外部宿主用长期密钥，
    应用内 UI 继续走既有登录 JWT（ADR-0005：不分叉桌面鉴权）。
    """
    from sag_api.services import access_key_service

    if token.startswith(access_key_service.KEY_PREFIX):
        return await access_key_service.authenticate_access_key(session, token)
    try:
        payload = decode_token(token)
    except jwt.PyJWTError as e:
        raise AuthError("令牌无效或已过期") from e
    user_id = payload.get("sub")
    user = await get_user(session, user_id) if user_id else None
    if user is None or not user.is_active:
        raise AuthError("用户不存在或已停用")
    return user


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if creds is None:
        raise AuthError("缺少认证令牌")
    user = await authenticate_bearer(session, creds.credentials)
    request.state.user = user
    return user


def get_engine_manager(request: Request) -> EngineManager:
    return request.app.state.engine_manager


def get_job_queue(request: Request) -> JobQueue:
    return request.app.state.job_queue


def get_llm(request: Request) -> LLMClient:
    return request.app.state.llm


def get_agent_runtime(request: Request) -> AgentRuntime:
    return request.app.state.agent_runtime


def get_tool_registry():
    """Agent 工具注册表（内置检索/实体工具 + 运行时注入的 MCP 工具）。"""
    from sag_api.tools import registry

    return registry
