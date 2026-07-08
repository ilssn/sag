from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.connectors import registry
from zleap_api.core.db import get_session
from zleap_api.core.deps import (
    get_engine_manager,
    get_job_queue,
    get_workspace_id,
    require_editor,
)
from zleap_api.jobs import JobQueue
from zleap_api.sag import EngineManager
from zleap_api.schemas.common import Ok
from zleap_api.schemas.job import JobOut
from zleap_api.schemas.source import ConnectorOut, SourceCreate, SourceOut, SourceUpdate
from zleap_api.services.source_service import (
    create_source,
    delete_source,
    get_source,
    list_sources,
    sync_source,
    update_source,
)

router = APIRouter(prefix="/sources", tags=["sources"])


# 注意：静态路由须在 /{source_id} 之前声明
@router.get("/connectors", response_model=list[ConnectorOut])
async def list_connectors() -> list[ConnectorOut]:
    return [ConnectorOut(**c.meta.to_public()) for c in registry.all()]


@router.get("", response_model=list[SourceOut])
async def list_(
    namespace_id: str | None = None,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> list[SourceOut]:
    sources = await list_sources(session, workspace_id, namespace_id=namespace_id)
    return [SourceOut.model_validate(s) for s in sources]


@router.post("", response_model=SourceOut, status_code=201)
async def create(
    body: SourceCreate,
    workspace_id: str = Depends(get_workspace_id),
    _editor=Depends(require_editor),
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
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
) -> SourceOut:
    return SourceOut.model_validate(await update_source(session, workspace_id, source_id, body))


@router.delete("/{source_id}", response_model=Ok)
async def delete_(
    source_id: str,
    workspace_id: str = Depends(get_workspace_id),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> Ok:
    from zleap_api.core.config import settings

    await delete_source(
        session,
        workspace_id,
        source_id,
        engine_manager=engine_manager,
        upload_dir=settings.upload_dir,
    )
    return Ok(detail="信源已删除")


@router.get("/{source_id}/chunks/{chunk_id}")
async def get_chunk(
    source_id: str,
    chunk_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    engine_manager: EngineManager = Depends(get_engine_manager),
) -> dict:
    """引用溯源：读取某分块的完整原文。"""
    from zleap_api.core.errors import NotFoundError

    source = await get_source(session, workspace_id, source_id)
    chunk = await engine_manager.get_chunk(source.sag_source_config_id, chunk_id, source=source)
    if chunk is None:
        raise NotFoundError("原文分块不存在")
    return {**chunk.model_dump(), "source_id": source.id, "source_name": source.name}


@router.post("/{source_id}/sync", response_model=JobOut)
async def sync(
    source_id: str,
    workspace_id: str = Depends(get_workspace_id),
    _editor=Depends(require_editor),
    session: AsyncSession = Depends(get_session),
    job_queue: JobQueue = Depends(get_job_queue),
) -> JobOut:
    job = await sync_source(session, workspace_id, source_id, job_queue=job_queue)
    return JobOut.model_validate(job)
