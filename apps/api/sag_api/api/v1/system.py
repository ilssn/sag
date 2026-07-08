from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from sag_api.core.config import settings
from sag_api.core.db import SessionLocal
from sag_api.core.logging import get_logger

router = APIRouter(prefix="/system", tags=["system"])
log = get_logger("system")


@router.get("/health")
async def health() -> dict:
    """存活探针：进程在跑即 200（不触碰依赖）。"""
    return {"status": "ok"}


@router.get("/ready")
async def ready() -> JSONResponse:
    """就绪探针：数据库可连通才 200，否则 503（供 compose/K8s 健康检查）。"""
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        log.warning("就绪检查失败：%s", e)
        return JSONResponse(status_code=503, content={"status": "unavailable", "db": False})
    return JSONResponse(content={"status": "ready", "db": True})


@router.get("/capabilities")
async def capabilities() -> dict:
    """能力探测：供前端判断是否已配置 LLM、当前引擎后端等。"""
    return {
        "llm_configured": settings.llm_configured,
        "llm_model": settings.llm_model,
        "embedding_model": settings.embedding_model,
        "vector_provider": settings.sag_vector_provider,
        "language": settings.sag_language,
        "search_strategy": settings.search_strategy,
        "max_upload_mb": settings.max_upload_mb,
        "allowed_upload_exts": sorted(settings.allowed_upload_exts),
    }
