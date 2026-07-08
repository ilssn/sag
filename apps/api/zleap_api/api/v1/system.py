from __future__ import annotations

from fastapi import APIRouter

from zleap_api.core.config import settings

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


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
    }
