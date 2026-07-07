from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.connectors import registry
from muse_api.core.db import get_session
from muse_api.core.deps import get_engine_manager, get_workspace_id
from muse_api.sag import EngineManager
from muse_api.schemas.common import Ok
from muse_api.schemas.source import ConnectorOut, SourceCreate, SourceOut, SourceUpdate
from muse_api.services.source_service import (
    create_source,
    delete_source,
    get_source,
    list_sources,
    update_source,
)

router = APIRouter(prefix="/sources", tags=["sources"])


# 注意：静态路由须在 /{source_id} 之前声明
@router.get("/connectors", response_model=list[ConnectorOut])
async def list_connectors() -> list[ConnectorOut]:
    return [ConnectorOut(**c.meta.to_public()) for c in registry.all()]


@router.get("", response_model=list[SourceOut])
async def list_(
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> list[SourceOut]:
    return [SourceOut.model_validate(s) for s in await list_sources(session, workspace_id)]


@router.post("", response_model=SourceOut, status_code=201)
async def create(
    body: SourceCreate,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> SourceOut:
    source = await create_source(session, workspace_id, body, engine_manager=engine_manager)
    return SourceOut.model_validate(source)


@router.get("/{source_id}", response_model=SourceOut)
async def get_(
    source_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> SourceOut:
    return SourceOut.model_validate(await get_source(session, workspace_id, source_id))


@router.patch("/{source_id}", response_model=SourceOut)
async def update_(
    source_id: str,
    body: SourceUpdate,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> SourceOut:
    return SourceOut.model_validate(await update_source(session, workspace_id, source_id, body))


@router.delete("/{source_id}", response_model=Ok)
async def delete_(
    source_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> Ok:
    await delete_source(session, workspace_id, source_id)
    return Ok(detail="信源已删除")
