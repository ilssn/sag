"""任务处理器 —— 按 JobType 分发。

处理器只关心「做什么」；状态机（queued/running/succeeded/failed）由队列 worker 统一维护。
处理器内部负责领域对象（Document/Source）的阶段状态与计数更新。
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.config import settings
from sag_api.core.errors import NotFoundError
from sag_api.core.logging import get_logger
from sag_api.db.models import Document, Job, Source
from sag_api.enums import DocumentStatus, JobType
from sag_api.parsing import prepare_document
from sag_api.sag import EngineManager

log = get_logger("jobs")

TaskHandler = Callable[[AsyncSession, Job], Awaitable[None]]


async def process_document(
    session: AsyncSession, job: Job, *, engine_manager: EngineManager, job_queue=None
) -> None:
    """ingest → extract 一篇文档，并推进其状态与计数。"""
    document = await session.get(Document, job.document_id) if job.document_id else None
    if document is None:
        raise NotFoundError("文档不存在")
    source = await session.get(Source, document.source_id)
    if source is None:
        raise NotFoundError("信源不存在")

    async def on_stage(stage: str) -> None:
        if stage == "loading":
            document.status = DocumentStatus.LOADING
            job.progress = 0.3
        elif stage == "extracting":
            document.status = DocumentStatus.EXTRACTING
            job.progress = 0.7
        await session.commit()

    async def on_parser_state(state: dict) -> None:
        document.status = DocumentStatus.LOADING
        job.progress = 0.15
        job.payload = {**(job.payload or {}), "document_parser": state}
        await session.commit()

    try:
        prepared = await prepare_document(
            document.storage_path,
            settings,
            state=(job.payload or {}).get("document_parser"),
            on_state=on_parser_state,
        )
        if prepared.fallback_from:
            log.warning(
                "文档解析已降级 doc=%s job=%s from=%s to=%s cached=%s error=%s",
                document.id,
                getattr(job, "id", None),
                prepared.fallback_from,
                prepared.provider,
                prepared.cached,
                prepared.fallback_error,
            )
        outcome = await engine_manager.process_document(
            source.sag_source_config_id,
            prepared.path,
            source=source,
            on_stage=on_stage,
        )
    except Exception as e:  # noqa: BLE001 - 记录到文档后再上抛给 worker
        document.status = DocumentStatus.FAILED
        document.error = getattr(e, "message", None) or str(e)
        await session.commit()
        raise

    document.status = DocumentStatus.READY
    document.chunk_count = outcome.chunk_count
    document.event_count = outcome.event_count
    document.sag_source_id = outcome.source_id
    document.error = None
    # 信源聚合计数用原子 SQL 更新，避免并发读改写丢失
    await session.execute(
        update(Source)
        .where(Source.id == source.id)
        .values(
            chunk_count=Source.chunk_count + outcome.chunk_count,
            event_count=Source.event_count + outcome.event_count,
        )
    )
    await session.commit()
    log.info(
        "文档处理完成 doc=%s parser=%s cached=%s chunks=%d events=%d",
        document.id,
        prepared.provider,
        prepared.cached,
        outcome.chunk_count,
        outcome.event_count,
    )


async def sync_source(session: AsyncSession, job: Job, *, engine_manager=None, job_queue=None) -> None:
    """动态连接器同步：discover → fetch → 登记文档并入队处理（复用 ingest→extract 管线）。"""
    # 延迟导入避免与 jobs 包的循环依赖
    from sag_api.connectors import registry
    from sag_api.core.config import settings
    from sag_api.services.document_service import create_document_from_upload

    source = await session.get(Source, job.source_id) if job.source_id else None
    if source is None:
        raise NotFoundError("信源不存在")

    connector = registry.get(source.connector_kind)
    discovered = await connector.discover(source.config or {})
    fetched = 0
    for d in discovered:
        try:
            local = await connector.fetch(source.config or {}, d)
            with open(local.path, "rb") as f:
                data = f.read()
        except Exception as e:  # noqa: BLE001 - 单篇失败不影响整体同步
            log.warning("同步抓取失败 %s：%s", d.external_id, getattr(e, "message", None) or e)
            continue
        await create_document_from_upload(
            session,
            source,
            filename=local.filename,
            content_type=local.content_type,
            data=data,
            upload_dir=settings.upload_dir,
            job_queue=job_queue,
        )
        try:
            os.remove(local.path)
        except OSError:
            pass
        fetched += 1

    job.progress = 1.0
    job.payload = {**(job.payload or {}), "discovered": len(discovered), "fetched": fetched}
    await session.commit()
    log.info("同步完成 source=%s 发现=%d 抓取=%d", source.id, len(discovered), fetched)


TASK_HANDLERS: dict[JobType, TaskHandler] = {
    JobType.PROCESS_DOCUMENT: process_document,
    JobType.SYNC_SOURCE: sync_source,
}
