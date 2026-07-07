"""任务处理器 —— 按 JobType 分发。

处理器只关心「做什么」；状态机（queued/running/succeeded/failed）由队列 worker 统一维护。
处理器内部负责领域对象（Document/Source）的阶段状态与计数更新。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.core.errors import NotFoundError
from muse_api.core.logging import get_logger
from muse_api.db.models import Document, Job, Source
from muse_api.enums import DocumentStatus, JobType
from muse_api.sag import EngineManager

log = get_logger("jobs")

TaskHandler = Callable[[AsyncSession, Job], Awaitable[None]]


async def process_document(session: AsyncSession, job: Job, *, engine_manager: EngineManager) -> None:
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

    try:
        outcome = await engine_manager.process_document(
            source.sag_source_config_id,
            document.storage_path,
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
        "文档处理完成 doc=%s chunks=%d events=%d",
        document.id,
        outcome.chunk_count,
        outcome.event_count,
    )


TASK_HANDLERS: dict[JobType, TaskHandler] = {
    JobType.PROCESS_DOCUMENT: process_document,
}
