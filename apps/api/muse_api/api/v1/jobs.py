from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from muse_api.core.db import get_session
from muse_api.core.deps import get_workspace_id
from muse_api.core.errors import NotFoundError
from muse_api.db.models import Job, Source
from muse_api.schemas.job import JobOut

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: str,
    workspace_id: str = Depends(get_workspace_id),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    job = await session.get(Job, job_id)
    if job is None:
        raise NotFoundError("任务不存在")
    if job.source_id:
        source = await session.get(Source, job.source_id)
        if source is None or source.workspace_id != workspace_id:
            raise NotFoundError("任务不存在")
    return JobOut.model_validate(job)
