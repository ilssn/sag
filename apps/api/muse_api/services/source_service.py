"""信源领域逻辑。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.connectors import registry
from muse_api.core.errors import MuseError, NotFoundError, ValidationError
from muse_api.core.logging import get_logger
from muse_api.db.base import new_id
from muse_api.db.models import Job, Source
from muse_api.enums import CONNECTOR_SOURCE_TYPE, JobStatus, JobType, NamespaceKind, SourceType
from muse_api.jobs import JobQueue
from muse_api.sag import EngineManager
from muse_api.schemas.source import SourceCreate, SourceUpdate
from muse_api.services.namespace_service import default_namespace, get_namespace

log = get_logger("services.source")


async def list_sources(
    session: AsyncSession, workspace_id: str, *, namespace_id: str | None = None
) -> list[Source]:
    stmt = select(Source).where(Source.workspace_id == workspace_id)
    if namespace_id:
        stmt = stmt.where(Source.namespace_id == namespace_id)
    rows = await session.execute(stmt.order_by(Source.created_at.desc()))
    return list(rows.scalars().all())


async def get_source(session: AsyncSession, workspace_id: str, source_id: str) -> Source:
    source = await session.get(Source, source_id)
    if source is None or source.workspace_id != workspace_id:
        raise NotFoundError("信源不存在")
    return source


async def create_source(
    session: AsyncSession,
    workspace_id: str,
    data: SourceCreate,
    *,
    engine_manager: EngineManager,
) -> Source:
    connector = registry.get(data.connector_kind)
    connector.validate_config(data.config)

    # 命名空间：显式指定则校验归属，否则落默认「知识」
    if data.namespace_id:
        namespace = await get_namespace(session, workspace_id, data.namespace_id)
    else:
        namespace = await default_namespace(session, workspace_id, NamespaceKind.KNOWLEDGE)
    source_type = CONNECTOR_SOURCE_TYPE.get(data.connector_kind, SourceType.DOCUMENT)

    source = Source(
        workspace_id=workspace_id,
        namespace_id=namespace.id,
        name=data.name,
        description=data.description,
        source_type=source_type,
        connector_kind=data.connector_kind,
        sag_source_config_id=f"src_{new_id()[:16]}",
        config=data.config or {},
    )
    session.add(source)
    await session.commit()
    await session.refresh(source)

    # 预建引擎 schema（幂等）；失败不阻断创建，处理文档时会重试
    try:
        await engine_manager.provision(source.sag_source_config_id, source)
    except MuseError as e:
        log.warning("信源引擎预建失败 %s：%s", source.sag_source_config_id, e.message)
    return source


async def update_source(
    session: AsyncSession, workspace_id: str, source_id: str, data: SourceUpdate
) -> Source:
    source = await get_source(session, workspace_id, source_id)
    if data.name is not None:
        source.name = data.name
    if data.description is not None:
        source.description = data.description
    if data.status is not None:
        source.status = data.status
    await session.commit()
    await session.refresh(source)
    return source


async def delete_source(session: AsyncSession, workspace_id: str, source_id: str) -> None:
    source = await get_source(session, workspace_id, source_id)
    await session.delete(source)
    await session.commit()
    # 注：MVP 暂不清除引擎侧该源的向量 / 图谱数据（保留在 data_dir）。


async def sync_source(
    session: AsyncSession, workspace_id: str, source_id: str, *, job_queue: JobQueue
) -> Job:
    """触发一次动态连接器同步（如网页抓取）。"""
    source = await get_source(session, workspace_id, source_id)
    connector = registry.get(source.connector_kind)
    if not connector.meta.supports_sync:
        raise ValidationError("该连接器不支持同步")
    job = Job(type=JobType.SYNC_SOURCE, source_id=source.id, status=JobStatus.QUEUED)
    session.add(job)
    await session.commit()
    await session.refresh(job)
    await job_queue.enqueue(job.id)
    return job
