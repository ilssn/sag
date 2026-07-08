"""文档领域逻辑：上传落盘 → 登记 → 入队处理。"""

from __future__ import annotations

import os

from sqlalchemy import case, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.errors import NotFoundError
from sag_api.db.base import new_id
from sag_api.db.models import Document, Job, Source
from sag_api.enums import DocumentStatus, JobStatus, JobType
from sag_api.jobs import JobQueue


async def list_documents(session: AsyncSession, source_id: str) -> list[Document]:
    rows = await session.execute(
        select(Document).where(Document.source_id == source_id).order_by(Document.created_at.desc())
    )
    return list(rows.scalars().all())


async def get_document(session: AsyncSession, source: Source, document_id: str) -> Document:
    doc = await session.get(Document, document_id)
    if doc is None or doc.source_id != source.id:
        raise NotFoundError("文档不存在")
    return doc


async def create_document_from_upload(
    session: AsyncSession,
    source: Source,
    *,
    filename: str,
    content_type: str,
    data: bytes,
    upload_dir: str,
    job_queue: JobQueue,
) -> tuple[Document, Job]:
    doc_id = new_id()
    safe_name = os.path.basename(filename) or "upload"
    dest_dir = os.path.join(upload_dir, source.id)
    os.makedirs(dest_dir, exist_ok=True)
    storage_path = os.path.join(dest_dir, f"{doc_id}_{safe_name}")
    with open(storage_path, "wb") as f:
        f.write(data)

    document = Document(
        id=doc_id,
        source_id=source.id,
        filename=safe_name,
        content_type=content_type or "application/octet-stream",
        size_bytes=len(data),
        storage_path=storage_path,
        status=DocumentStatus.PENDING,
    )
    session.add(document)
    await session.execute(
        update(Source).where(Source.id == source.id).values(document_count=Source.document_count + 1)
    )
    job = Job(
        type=JobType.PROCESS_DOCUMENT,
        source_id=source.id,
        document_id=doc_id,
        status=JobStatus.QUEUED,
    )
    session.add(job)
    await session.commit()
    await session.refresh(document)
    await session.refresh(job)

    await job_queue.enqueue(job.id)
    return document, job


def _format_messages(messages: list[dict]) -> str:
    lines = ["# 消息", ""]
    for m in messages:
        who = m.get("author") or m.get("role") or "消息"
        ts = f"（{m['ts']}）" if m.get("ts") else ""
        lines.append(f"**{who}**{ts}：{m.get('text') or ''}")
    return "\n\n".join(lines)


async def ingest_content(
    session: AsyncSession,
    source: Source,
    *,
    text: str | None = None,
    title: str | None = None,
    messages: list[dict] | None = None,
    upload_dir: str,
    job_queue: JobQueue,
) -> Document:
    """统一写入：把文本 / 一批消息归一为文档 → 复用 ingest/extract 管线（持续写入）。"""
    from sag_api.core.errors import ValidationError

    if messages:
        content = _format_messages(messages)
        filename = f"{title or f'消息-{len(messages)}条'}.md"
    elif text:
        content = (f"# {title}\n\n" if title else "") + text
        filename = f"{title or '文本'}.md"
    else:
        raise ValidationError("请提供 text 或 messages")

    document, _job = await create_document_from_upload(
        session,
        source,
        filename=filename,
        content_type="text/markdown",
        data=content.encode("utf-8"),
        upload_dir=upload_dir,
        job_queue=job_queue,
    )
    return document


async def reprocess_document(
    session: AsyncSession, source: Source, document_id: str, *, job_queue: JobQueue
) -> Job:
    document = await get_document(session, source, document_id)
    document.status = DocumentStatus.PENDING
    document.error = None
    job = Job(
        type=JobType.PROCESS_DOCUMENT,
        source_id=source.id,
        document_id=document.id,
        status=JobStatus.QUEUED,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    await job_queue.enqueue(job.id)
    return job


async def delete_document(session: AsyncSession, source: Source, document_id: str) -> None:
    document = await get_document(session, source, document_id)
    path = document.storage_path
    await session.delete(document)
    await session.execute(
        update(Source)
        .where(Source.id == source.id)
        .values(
            document_count=case(
                (Source.document_count > 0, Source.document_count - 1), else_=0
            )
        )
    )
    await session.commit()
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass
