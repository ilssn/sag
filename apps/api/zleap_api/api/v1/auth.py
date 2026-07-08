from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.deps import get_current_user
from zleap_api.core.security import create_access_token
from zleap_api.db.models import User
from zleap_api.enums import AuditAction
from zleap_api.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut
from zleap_api.schemas.workspace import WorkspaceOut
from zleap_api.services import audit_service
from zleap_api.services.auth_service import authenticate, default_workspace_id, register_user

router = APIRouter(prefix="/auth", tags=["auth"])


async def _audit_auth(session: AsyncSession, request: Request, user: User, action: AuditAction) -> None:
    ws_id = await default_workspace_id(session, user.id)
    await audit_service.record(
        workspace_id=ws_id or "",
        action=action,
        actor=user,
        target_type="user",
        target_id=user.id,
        target_label=user.email,
        ip=audit_service.client_ip(request),
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(
    body: RegisterRequest, request: Request, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    user = await register_user(session, email=body.email, password=body.password, name=body.name)
    resp = TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))
    await _audit_auth(session, request, user, AuditAction.USER_REGISTER)
    return resp


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest, request: Request, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    user = await authenticate(session, email=body.email, password=body.password)
    resp = TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))
    await _audit_auth(session, request, user, AuditAction.USER_LOGIN)
    return resp


@router.get("/me", response_model=UserOut)
async def me(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    from zleap_api.services.workspace_service import list_my_workspaces

    out = UserOut.model_validate(user)
    out.memberships = [WorkspaceOut(**w) for w in await list_my_workspaces(session, user.id)]
    return out
