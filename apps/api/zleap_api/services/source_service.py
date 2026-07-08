"""信源领域逻辑。"""

from __future__ import annotations

import os
import shutil

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.connectors import registry
from zleap_api.core.errors import MuseError, NotFoundError, ValidationError
from zleap_api.core.logging import get_logger
from zleap_api.db.base import new_id
from zleap_api.db.models import Job, Source
from zleap_api.enums import CONNECTOR_SOURCE_TYPE, JobStatus, JobType, NamespaceKind, SourceType
from zleap_api.jobs import JobQueue
from zleap_api.sag import EngineManager
from zleap_api.schemas.source import SourceCreate, SourceUpdate
from zleap_api.services.namespace_service import default_namespace, get_namespace

log = get_logger("services.source")


async def list_sources(
    session: AsyncSession,
    workspace_id: str,
    *,
    namespace_id: str | None = None,
    include_memory: bool = False,
) -> list[Source]:
    """列出信源。默认排除会话记忆（记忆是助手的能力呈现，不作为信源暴露）。"""
    stmt = select(Source).where(Source.workspace_id == workspace_id)
    if not include_memory:
        stmt = stmt.where(Source.source_type != SourceType.CONVERSATION)
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


async def delete_source(
    session: AsyncSession,
    workspace_id: str,
    source_id: str,
    *,
    engine_manager: EngineManager,
    upload_dir: str,
) -> None:
    """删除信源并收尾：移除悬挂绑定、关闭引擎槽、清理上传文件。"""
    from zleap_api.db.models import SoulBinding
    from zleap_api.enums import BindingTargetType

    source = await get_source(session, workspace_id, source_id)
    sag_id = source.sag_source_config_id

    # 悬挂绑定清理（target_id 为普通字符串，无 FK 级联）
    await session.execute(
        SoulBinding.__table__.delete().where(
            SoulBinding.target_type == BindingTargetType.SOURCE,
            SoulBinding.target_id == source.id,
        )
    )
    await session.delete(source)
    await session.commit()

    # 引擎槽关闭 + 上传目录清理（尽力而为，不阻断删除）
    await engine_manager.release(sag_id)
    shutil.rmtree(os.path.join(upload_dir, source_id), ignore_errors=True)
    # 注：引擎侧向量 / 图谱数据的彻底清除留待企业档（合规删除）。


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
