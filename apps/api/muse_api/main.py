"""muse-api 应用入口。"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from muse_api import __version__
from muse_api.api.v1 import api_router
from muse_api.core.config import settings
from muse_api.core.db import SessionLocal, dispose_db, init_db
from muse_api.core.errors import MuseError
from muse_api.core.logging import configure_logging, get_logger
from muse_api.generation import LLMClient
from muse_api.jobs import InProcessAsyncQueue
from muse_api.sag import EngineManager

log = get_logger("app")


# 已知不安全的默认密钥（生产环境拒绝启动）
_INSECURE_SECRETS = {
    "dev-insecure-secret-change-me-in-production-0123456789",
    "please-change-this-in-production-0123456789",
    "dev-secret-change-me",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging("DEBUG" if settings.debug else "INFO")
    if settings.environment == "prod" and settings.secret_key in _INSECURE_SECRETS:
        raise RuntimeError(
            "生产环境禁止使用默认 MUSE_SECRET_KEY。"
            "请设置强随机值（≥32 字节），例如：openssl rand -hex 32"
        )
    os.makedirs(settings.data_dir, exist_ok=True)
    os.makedirs(settings.upload_dir, exist_ok=True)

    await init_db()

    app.state.engine_manager = EngineManager(settings)
    app.state.llm = LLMClient(settings)
    app.state.job_queue = InProcessAsyncQueue(
        SessionLocal, app.state.engine_manager, concurrency=settings.job_concurrency
    )
    await app.state.job_queue.start()

    log.info(
        "muse-api 已启动 · env=%s · llm_configured=%s · vector=%s",
        settings.environment,
        settings.llm_configured,
        settings.sag_vector_provider,
    )
    try:
        yield
    finally:
        await app.state.job_queue.stop()
        await app.state.engine_manager.aclose_all()
        await dispose_db()


def create_app() -> FastAPI:
    app = FastAPI(
        title="muse API",
        version=__version__,
        summary="开源知识库平台 · 从信息源到知识问答",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(MuseError)
    async def _handle_muse_error(_request: Request, exc: MuseError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(_request: Request, exc: Exception) -> JSONResponse:
        log.exception("未处理异常：%s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "internal_error", "message": "服务器内部错误"}},
        )

    app.include_router(api_router)

    @app.get("/", tags=["system"])
    async def root() -> dict:
        return {"name": "muse", "version": __version__, "docs": "/docs"}

    return app


app = create_app()
