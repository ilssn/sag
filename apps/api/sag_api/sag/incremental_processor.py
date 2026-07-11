"""zleap-sag 的并发、进度和断点适配层。

上游 DataEngine 只暴露整篇 extract；这里把抽取拆成独立 chunk 任务，
每个 chunk 保存成功后立即持久化断点，暂停或重试时从最近确认的断点继续。
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Any, Literal

from zleap.sag import DataEngine
from zleap.sag.modules.extract.config import ExtractConfig
from zleap.sag.modules.extract.extractor import EventExtractor
from zleap.sag.modules.load.config import DocumentLoadConfig
from zleap.sag.modules.load.loader import DocumentLoader

from sag_api.sag.dto import ProcessCheckpoint, ProcessOutcome

CheckpointCallback = Callable[[ProcessCheckpoint], Awaitable[None]]
PauseCheck = Callable[[], Awaitable[bool]]
StageCallback = Callable[[str], Awaitable[None]]


def _llm_chat_owner(client: Any) -> Any:
    """找到真正执行 chat 的最内层 zleap-sag 客户端。"""
    current = client
    seen: set[int] = set()
    while id(current) not in seen:
        seen.add(id(current))
        nested = getattr(current, "client", None)
        if nested is None or not callable(getattr(nested, "chat", None)):
            break
        current = nested
    return current


def _usage_value(value: Any, field: str) -> int:
    raw = value.get(field, 0) if isinstance(value, Mapping) else getattr(value, field, 0)
    try:
        return int(raw or 0)
    except (TypeError, ValueError):
        return 0


def _response_token_usage(response: Any) -> int:
    for value in (
        response,
        getattr(response, "usage", None),
        getattr(response, "usage_metadata", None),
    ):
        if value is None:
            continue
        total = _usage_value(value, "total_tokens")
        if total > 0:
            return total
        input_tokens = _usage_value(value, "prompt_tokens") or _usage_value(
            value, "input_tokens"
        )
        output_tokens = _usage_value(value, "completion_tokens") or _usage_value(
            value, "output_tokens"
        )
        if input_tokens + output_tokens > 0:
            return input_tokens + output_tokens
    return 0


class IncrementalDocumentProcessor:
    def __init__(
        self,
        engine: DataEngine,
        source_config_id: str,
        *,
        max_concurrency: int,
        chunk_max_tokens: int = 1_000,
        chunk_mode: Literal["standard", "heading_strict"] = "standard",
    ) -> None:
        self._engine = engine
        self._source_config_id = source_config_id
        self._max_concurrency = max(1, min(100, max_concurrency))
        self._chunk_max_tokens = chunk_max_tokens
        self._chunk_mode = chunk_mode

    async def process(
        self,
        path: str | Path | None,
        *,
        checkpoint: ProcessCheckpoint,
        on_checkpoint: CheckpointCallback,
        should_pause: PauseCheck,
        on_stage: StageCallback | None = None,
    ) -> ProcessOutcome:
        current = checkpoint.model_copy(deep=True)
        if not current.chunk_ids:
            if path is None:
                raise RuntimeError("文档尚未切片，无法从断点继续")
            if on_stage:
                await on_stage("loading")
            loaded = await DocumentLoader().load(
                DocumentLoadConfig(
                    path=str(path),
                    source_config_id=self._source_config_id,
                    max_tokens=self._chunk_max_tokens,
                    chunk_mode=self._chunk_mode,
                )
            )
            current.source_id = getattr(loaded, "source_id", None)
            current.chunk_ids = list(getattr(loaded, "chunk_ids", []) or [])
            current.processed_chunk_ids = []
            current.event_count = 0
            current.event_ids = []
            current.token_usage = 0
            await on_checkpoint(current.model_copy(deep=True))

        if on_stage:
            await on_stage("extracting")

        processed = set(current.processed_chunk_ids)
        remaining = [chunk_id for chunk_id in current.chunk_ids if chunk_id not in processed]
        if remaining and not await should_pause():
            await self._extract_remaining(
                remaining,
                current=current,
                on_checkpoint=on_checkpoint,
                should_pause=should_pause,
            )

        paused = len(current.processed_chunk_ids) < len(current.chunk_ids)
        if not paused:
            await self._normalize_event_ranks(current.chunk_ids)
        return ProcessOutcome(
            source_id=current.source_id,
            chunk_count=len(current.chunk_ids),
            event_count=current.event_count,
            chunk_ids=list(current.chunk_ids),
            event_ids=list(current.event_ids),
            processed_chunk_ids=list(current.processed_chunk_ids),
            token_usage=current.token_usage,
            paused=paused,
        )

    async def _extract_remaining(
        self,
        chunk_ids: list[str],
        *,
        current: ProcessCheckpoint,
        on_checkpoint: CheckpointCallback,
        should_pause: PauseCheck,
    ) -> None:
        queue: asyncio.Queue[str] = asyncio.Queue()
        for chunk_id in chunk_ids:
            queue.put_nowait(chunk_id)
        checkpoint_lock = asyncio.Lock()

        async def worker() -> None:
            while not queue.empty():
                if await should_pause():
                    return
                try:
                    chunk_id = queue.get_nowait()
                except asyncio.QueueEmpty:
                    return
                try:
                    event_ids, token_usage = await self._extract_chunk(chunk_id)
                    async with checkpoint_lock:
                        if chunk_id in current.processed_chunk_ids:
                            continue
                        current.processed_chunk_ids.append(chunk_id)
                        current.event_ids.extend(event_ids)
                        current.event_count += len(event_ids)
                        current.token_usage += token_usage
                        await on_checkpoint(current.model_copy(deep=True))
                finally:
                    queue.task_done()

        worker_count = min(self._max_concurrency, len(chunk_ids))
        async with asyncio.TaskGroup() as group:
            for _ in range(worker_count):
                group.create_task(worker())

    async def _extract_chunk(self, chunk_id: str) -> tuple[list[str], int]:
        template = getattr(self._engine, "_extractor", None)
        if template is None:
            raise RuntimeError("抽取引擎尚未初始化")
        extractor = EventExtractor(
            prompt_manager=template.prompt_manager,
            model_config=template.model_config,
        )

        token_usage = 0
        client = await extractor._get_llm_client()
        chat_owner = _llm_chat_owner(client)
        original_chat = chat_owner.chat

        async def tracked_chat(*args: Any, **kwargs: Any):
            nonlocal token_usage
            response = await original_chat(*args, **kwargs)
            used = _response_token_usage(response)
            if used <= 0:
                messages = args[0] if args else kwargs.get("messages", [])
                input_chars = sum(
                    len(
                        str(
                            message.get("content", "")
                            if isinstance(message, dict)
                            else getattr(message, "content", "")
                        )
                    )
                    for message in messages
                )
                used = max(1, (input_chars + len(str(getattr(response, "content", ""))) + 2) // 3)
            token_usage += used
            return response

        chat_owner.chat = tracked_chat
        try:
            events = await extractor.extract(
                ExtractConfig(
                    source_config_id=self._source_config_id,
                    chunk_ids=[chunk_id],
                    max_concurrency=1,
                )
            )
        finally:
            chat_owner.chat = original_chat
        return [event.id for event in events], token_usage

    async def _normalize_event_ranks(self, chunk_ids: list[str]) -> None:
        if not chunk_ids:
            return
        from sqlalchemy import select
        from zleap.sag.db import SourceEvent, get_session_factory

        chunk_order = {chunk_id: index for index, chunk_id in enumerate(chunk_ids)}
        session_factory = get_session_factory()
        async with session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(SourceEvent).where(
                            SourceEvent.source_config_id == self._source_config_id,
                            SourceEvent.chunk_id.in_(chunk_ids),
                        )
                    )
                ).scalars()
            )
            rows.sort(
                key=lambda event: (
                    chunk_order.get(event.chunk_id or "", len(chunk_order)),
                    int(event.rank or 0),
                    event.id,
                )
            )
            for rank, event in enumerate(rows):
                event.rank = rank
            await session.commit()
