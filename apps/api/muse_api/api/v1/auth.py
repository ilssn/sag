from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.core.db import get_session
from muse_api.core.deps import get_current_user
from muse_api.core.security import create_access_token
from muse_api.db.models import User
from muse_api.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut
from muse_api.services.auth_service import authenticate, register_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    user = await register_user(session, email=body.email, password=body.password, name=body.name)
    return TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, session: AsyncSession = Depends(get_session)) -> TokenResponse:
    user = await authenticate(session, email=body.email, password=body.password)
    return TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
