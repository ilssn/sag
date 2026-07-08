from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from sag_api.core.config import settings
from sag_api.core.db import SessionLocal, get_session
from sag_api.core.deps import get_current_user
from sag_api.core.errors import MuseError
from sag_api.core.logging import get_logger
from sag_api.db.models import User
from sag_api.generation import LLMClient
from sag_api.schemas.system import ModelConfigUpdate
from sag_api.services import settings_service

router = APIRouter(prefix="/system", tags=["system"])
log = get_logger("system")


def _capabilities() -> dict:
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
    return _capabilities()


@router.get("/model-config")
async def get_model_config(
    _user: User = Depends(get_current_user),
) -> dict:
    """当前生效的模型与检索配置（密钥脱敏为 *_set 布尔）。"""
    return settings_service.effective_model_config()


@router.put("/model-config")
async def update_model_config(
    body: ModelConfigUpdate,
    request: Request,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """保存模型配置 → 入库 + 覆盖运行期 + 重建 LLM 客户端 + 重置暖引擎（无需重启即生效）。"""
    config = await settings_service.save_model_config(
        session, body.model_dump(exclude_unset=True)
    )
    # 重建运行期：新 LLM 客户端 + 让暖引擎按新配置重建
    request.app.state.llm = LLMClient(settings)
    await request.app.state.engine_manager.aclose_all()
    return {"config": config, "capabilities": _capabilities()}


@router.post("/model-config/test")
async def test_model_config(
    request: Request,
    _user: User = Depends(get_current_user),
) -> dict:
    """连接测试：用当前配置发一次最小请求，返回是否可用。"""
    llm: LLMClient = request.app.state.llm
    if not llm.configured:
        return {"ok": False, "message": "尚未配置 API Key"}
    try:
        await llm.complete([{"role": "user", "content": "ping"}])
        return {"ok": True, "message": f"连接成功 · {settings.llm_model}"}
    except MuseError as e:
        return {"ok": False, "message": e.message}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": str(e)}
