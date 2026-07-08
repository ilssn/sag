"""进程内 asyncio 任务队列 —— 随 API 进程起停。

- N 个 worker 协程从队列取 job_id，加载 Job，维护状态机并分发处理器。
- 启动时「恢复」上次残留的 QUEUED/RUNNING 任务（RUNNING 重置为 QUEUED 重跑）。
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from sag_api.core.config import settings
from sag_api.core.errors import ServiceUnavailableError, UpstreamError
from sag_api.core.logging import get_logger
from sag_api.enums import JobStatus
from sag_api.jobs.queue import JobQueue
from sag_api.jobs.tasks import TASK_HANDLERS
from sag_api.sag import EngineManager

log = get_logger("jobs")

# 退避基数（秒）：第 n 次重试等待 base**n。测试可 monkeypatch 缩短。
_BACKOFF_BASE_SECONDS = 2.0


def _now() -> datetime:
    return datetime.now(UTC)


def _is_retryable(exc: Exception) -> bool:
    """瞬时故障（限流/超时/上游暂不可用）可重试；输入/配置类错误不重试。"""
    return isinstance(exc, (ServiceUnavailableError, UpstreamError))


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
        self._retry_tasks: set[asyncio.Task] = set()
        self._started = False

    async def enqueue(self, job_id: str) -> None:
        await self._queue.put(job_id)

    def _schedule_retry(self, job_id: str, delay: float) -> None:
        """退避后重新入队（不阻塞 worker）。"""

        async def _later() -> None:
            try:
                await asyncio.sleep(delay)
                await self._queue.put(job_id)
            except asyncio.CancelledError:
                pass

        task = asyncio.create_task(_later(), name=f"sag-retry-{job_id}")
        self._retry_tasks.add(task)
        task.add_done_callback(self._retry_tasks.discard)

    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        for i in range(self._concurrency):
            self._workers.append(asyncio.create_task(self._worker_loop(i), name=f"sag-worker-{i}"))
        await self._recover()
        log.info("任务队列已启动（并发=%d）", self._concurrency)

    async def stop(self) -> None:
        for t in list(self._retry_tasks):
            t.cancel()
        self._retry_tasks.clear()
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
        from sag_api.db.models import Job

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
        from sag_api.db.models import Job

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
                await handler(session, job, engine_manager=self._engine_manager, job_queue=self)
                job.status = JobStatus.SUCCEEDED
                job.progress = 1.0
                job.finished_at = _now()
                job.error = None
            except Exception as e:  # noqa: BLE001
                await session.rollback()
                job = await session.get(Job, job_id)
                msg = getattr(e, "message", None) or str(e)
                attempts = job.attempts if job is not None else settings.job_max_attempts
                retry = job is not None and _is_retryable(e) and attempts < settings.job_max_attempts
                if job is not None:
                    if retry:
                        # 退避重排：状态回 QUEUED，延迟 base**attempts 秒后重新入队
                        job.status = JobStatus.QUEUED
                        job.progress = 0.0
                        job.error = f"第 {attempts} 次失败，将重试：{msg}"
                        delay = _BACKOFF_BASE_SECONDS**attempts
                        self._schedule_retry(job_id, delay)
                        log.warning(
                            "任务可重试 job=%s（第 %d/%d 次），%.1fs 后重排：%s",
                            job_id, attempts, settings.job_max_attempts, delay, msg,
                        )
                    else:
                        job.status = JobStatus.FAILED
                        job.error = msg
                        job.finished_at = _now()
                        log.warning("任务失败 job=%s（尝试 %d 次）：%s", job_id, attempts, msg)
            await session.commit()
