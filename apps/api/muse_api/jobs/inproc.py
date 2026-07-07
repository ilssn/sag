"""进程内 asyncio 任务队列 —— 随 API 进程起停。

- N 个 worker 协程从队列取 job_id，加载 Job，维护状态机并分发处理器。
- 启动时「恢复」上次残留的 QUEUED/RUNNING 任务（RUNNING 重置为 QUEUED 重跑）。
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from muse_api.core.logging import get_logger
from muse_api.enums import JobStatus
from muse_api.jobs.queue import JobQueue
from muse_api.jobs.tasks import TASK_HANDLERS
from muse_api.sag import EngineManager

log = get_logger("jobs")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class InProcessAsyncQueue(JobQueue):
    def __init__(
        self,
        session_factory: async_sessionmaker,
        engine_manager: EngineManager,
        *,
        concurrency: int = 2,
    ) -> None:
        self._session_factory = session_factory
        self._engine_manager = engine_manager
        self._concurrency = concurrency
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._started = False

    async def enqueue(self, job_id: str) -> None:
        await self._queue.put(job_id)

    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        for i in range(self._concurrency):
            self._workers.append(asyncio.create_task(self._worker_loop(i), name=f"muse-worker-{i}"))
        await self._recover()
        log.info("任务队列已启动（并发=%d）", self._concurrency)

    async def stop(self) -> None:
        for w in self._workers:
            w.cancel()
        for w in self._workers:
            try:
                await w
            except asyncio.CancelledError:
                pass
        self._workers.clear()
        self._started = False

    async def _recover(self) -> None:
        from muse_api.db.models import Job

        async with self._session_factory() as session:
            rows = (
                await session.execute(
                    select(Job).where(Job.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]))
                )
            ).scalars().all()
            for job in rows:
                if job.status == JobStatus.RUNNING:
                    job.status = JobStatus.QUEUED
            await session.commit()
            for job in rows:
                await self._queue.put(job.id)
            if rows:
                log.info("恢复 %d 个未完成任务", len(rows))

    async def _worker_loop(self, idx: int) -> None:
        while True:
            job_id = await self._queue.get()
            try:
                await self._run(job_id)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("worker#%d 处理 job=%s 异常", idx, job_id)
            finally:
                self._queue.task_done()

    async def _run(self, job_id: str) -> None:
        from muse_api.db.models import Job

        async with self._session_factory() as session:
            job = await session.get(Job, job_id)
            if job is None:
                return
            job.status = JobStatus.RUNNING
            job.started_at = _now()
            job.attempts += 1
            job.progress = 0.05
            job.error = None
            await session.commit()

            handler = TASK_HANDLERS.get(job.type)
            if handler is None:
                job.status = JobStatus.FAILED
                job.error = f"未知任务类型：{job.type}"
                job.finished_at = _now()
                await session.commit()
                return

            try:
                await handler(session, job, engine_manager=self._engine_manager)
                job.status = JobStatus.SUCCEEDED
                job.progress = 1.0
                job.finished_at = _now()
                job.error = None
            except Exception as e:  # noqa: BLE001
                await session.rollback()
                job = await session.get(Job, job_id)
                if job is not None:
                    job.status = JobStatus.FAILED
                    job.error = getattr(e, "message", None) or str(e)
                    job.finished_at = _now()
                log.warning("任务失败 job=%s: %s", job_id, getattr(e, "message", None) or str(e))
            await session.commit()
