from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.deps import get_workspace_id, require_editor
from zleap_api.schemas.common import Ok
from zleap_api.schemas.namespace import NamespaceCreate, NamespaceOut
from zleap_api.services.namespace_service import (
    create_namespace,
    delete_namespace,
    ensure_default_namespaces,
    list_namespaces,
)

router = APIRouter(prefix="/namespaces", tags=["namespaces"])


@router.get("", response_model=list[NamespaceOut])
async def list_(
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> list[NamespaceOut]:
    await ensure_default_namespaces(session, workspace_id)
    return [NamespaceOut.model_validate(n) for n in await list_namespaces(session, workspace_id)]


@router.post("", response_model=NamespaceOut, status_code=201)
async def create(
    body: NamespaceCreate,
    workspace_id: str = Depends(get_workspace_id),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
) -> NamespaceOut:
    ns = await create_namespace(
        session, workspace_id, name=body.name, icon=body.icon, color=body.color
    )
    return NamespaceOut.model_validate(ns)


@router.delete("/{namespace_id}", response_model=Ok)
async def delete_(
    namespace_id: str,
    workspace_id: str = Depends(get_workspace_id),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
) -> Ok:
    await delete_namespace(session, workspace_id, namespace_id)
    return Ok(detail="分组已删除")
