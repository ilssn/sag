from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.config import settings
from zleap_api.core.db import get_session
from zleap_api.core.deps import get_job_queue, get_workspace_id
from zleap_api.core.errors import ValidationError
from zleap_api.jobs import JobQueue
from zleap_api.schemas.common import Ok
from zleap_api.schemas.document import DocumentOut, IngestRequest
from zleap_api.schemas.job import JobOut
from zleap_api.services.document_service import (
    create_document_from_upload,
    delete_document,
    get_document,
    ingest_content,
    list_documents,
    reprocess_document,
)
from zleap_api.services.source_service import get_source

router = APIRouter(prefix="/sources/{source_id}/documents", tags=["documents"])


@router.get("", response_model=list[DocumentOut])
async def list_(
    source_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    source = await get_source(session, workspace_id, source_id)
    return [DocumentOut.model_validate(d) for d in await list_documents(session, source.id)]


@router.post("", response_model=DocumentOut, status_code=201)
async def upload(
    source_id: str,
    file: UploadFile = File(...),
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    job_queue: JobQueue = Depends(get_job_queue),
) -> DocumentOut:
    source = await get_source(session, workspace_id, source_id)
    data = await file.read()
    if not data:
        raise ValidationError("文件内容为空")
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise ValidationError(f"文件超过 {settings.max_upload_mb}MB 上限")
    document, _job = await create_document_from_upload(
        session,
        source,
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        data=data,
        upload_dir=settings.upload_dir,
        job_queue=job_queue,
    )
    return DocumentOut.model_validate(document)


@router.post("/ingest", response_model=DocumentOut, status_code=201)
async def ingest(
    source_id: str,
    body: IngestRequest,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    job_queue: JobQueue = Depends(get_job_queue),
) -> DocumentOut:
    """统一写入接口：外部系统持续推送文本 / 消息进入信源。"""
    source = await get_source(session, workspace_id, source_id)
    document = await ingest_content(
        session,
        source,
        text=body.text,
        title=body.title,
        messages=[m.model_dump() for m in body.messages] if body.messages else None,
        upload_dir=settings.upload_dir,
        job_queue=job_queue,
    )
    return DocumentOut.model_validate(document)


@router.get("/{document_id}", response_model=DocumentOut)
async def get_(
    source_id: str,
    document_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    source = await get_source(session, workspace_id, source_id)
    return DocumentOut.model_validate(await get_document(session, source, document_id))


@router.post("/{document_id}/reprocess", response_model=JobOut)
async def reprocess(
    source_id: str,
    document_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
    job_queue: JobQueue = Depends(get_job_queue),
) -> JobOut:
    source = await get_source(session, workspace_id, source_id)
    job = await reprocess_document(session, source, document_id, job_queue=job_queue)
    return JobOut.model_validate(job)


@router.delete("/{document_id}", response_model=Ok)
async def delete_(
    source_id: str,
    document_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> Ok:
    source = await get_source(session, workspace_id, source_id)
    await delete_document(session, source, document_id)
    return Ok(detail="文档已删除")
