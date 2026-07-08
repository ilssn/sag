from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.deps import (
    get_current_user,
    get_workspace_id,
    get_workspace_role,
    require_owner,
)
from zleap_api.core.errors import ForbiddenError
from zleap_api.db.models import User
from zleap_api.enums import AuditAction, WorkspaceRole
from zleap_api.schemas.common import Ok
from zleap_api.schemas.workspace import (
    InviteRequest,
    MemberOut,
    RoleUpdateRequest,
    WorkspaceOut,
)
from zleap_api.services import audit_service
from zleap_api.services import workspace_service as svc

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[WorkspaceOut])
async def my_workspaces(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[WorkspaceOut]:
    return [WorkspaceOut(**w) for w in await svc.list_my_workspaces(session, user.id)]


@router.get("/current/members", response_model=list[MemberOut])
async def members(
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> list[MemberOut]:
    return [MemberOut(**m) for m in await svc.list_members(session, workspace_id)]


@router.post("/current/members", response_model=MemberOut, status_code=201)
async def invite(
    body: InviteRequest,
    request: Request,
    workspace_id: str = Depends(get_workspace_id),
    _owner=Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> MemberOut:
    m = await svc.invite_member(session, workspace_id, email=body.email, role=body.role)
    await audit_service.record_request(
        request,
        AuditAction.MEMBER_INVITE,
        target_type="user",
        target_id=m["user_id"],
        target_label=m["email"],
        meta={"role": str(m["role"])},
    )
    return MemberOut(**m)


@router.patch("/current/members/{member_user_id}", response_model=MemberOut)
async def update_role(
    member_user_id: str,
    body: RoleUpdateRequest,
    request: Request,
    workspace_id: str = Depends(get_workspace_id),
    _owner=Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> MemberOut:
    m = await svc.update_member_role(session, workspace_id, member_user_id, role=body.role)
    await audit_service.record_request(
        request,
        AuditAction.MEMBER_ROLE,
        target_type="user",
        target_id=member_user_id,
        target_label=m["email"],
        meta={"role": str(m["role"])},
    )
    return MemberOut(**m)


@router.delete("/current/members/{member_user_id}", response_model=Ok)
async def remove(
    member_user_id: str,
    request: Request,
    workspace_id: str = Depends(get_workspace_id),
    role: WorkspaceRole = Depends(get_workspace_role),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Ok:
    # owner 可移除任何人；普通成员仅可移除自己（退出空间）
    leaving = member_user_id == user.id
    if not leaving and role != WorkspaceRole.OWNER:
        raise ForbiddenError("仅空间所有者可移除其他成员")
    await svc.remove_member(session, workspace_id, member_user_id)
    await audit_service.record_request(
        request,
        AuditAction.MEMBER_REMOVE,
        target_type="user",
        target_id=member_user_id,
        meta={"self": leaving},
    )
    return Ok(detail="已退出空间" if leaving else "成员已移除")
