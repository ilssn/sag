from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.db import get_session
from zleap_api.core.deps import get_workspace_id, require_owner
from zleap_api.schemas.audit import AuditOut, AuditPage
from zleap_api.services import audit_service

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=AuditPage)
async def list_(
    action: str | None = None,
    actor: str | None = Query(default=None, description="按操作者邮箱模糊过滤"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    workspace_id: str = Depends(get_workspace_id),
    _owner=Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> AuditPage:
    rows, total = await audit_service.list_audit(
        session, workspace_id, action=action, actor_email=actor, limit=limit, offset=offset
    )
    return AuditPage(
        items=[AuditOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/export")
async def export(
    action: str | None = None,
    actor: str | None = None,
    workspace_id: str = Depends(get_workspace_id),
    _owner=Depends(require_owner),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """导出审计为 CSV（最多 5000 行，满足合规留档）。"""
    rows, _ = await audit_service.list_audit(
        session, workspace_id, action=action, actor_email=actor, limit=5000, offset=0
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["时间", "操作者", "动作", "对象类型", "对象", "对象ID", "IP", "详情"]
    )
    for r in rows:
        writer.writerow(
            [
                r.created_at.isoformat(),
                r.actor_email,
                r.action,
                r.target_type,
                r.target_label,
                r.target_id,
                r.ip,
                r.meta_json,
            ]
        )
    buf.seek(0)
    # UTF-8 BOM 让 Excel 正确识别中文
    data = "﻿" + buf.getvalue()
    return StreamingResponse(
        iter([data]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="zleap-audit.csv"'},
    )
