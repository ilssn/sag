"""维护模式（ADR-0014）：启动关卡失败 → 进程存活、业务 API 关闭、仅开放 /system/*。"""

from __future__ import annotations

import httpx
import pytest


@pytest.mark.asyncio
async def test_migration_failure_enters_maintenance_and_gates_business_api(monkeypatch):
    from sag_api import main as main_module

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("模拟迁移失败")

    monkeypatch.setattr(main_module, "run_migrations", _boom)
    app = main_module.create_app()
    transport = httpx.ASGITransport(app=app)

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # 进程存活：health 仍 200
            assert (await client.get("/api/v1/system/health")).status_code == 200
            # 就绪探针 503
            ready = await client.get("/api/v1/system/ready")
            assert ready.status_code == 503
            # 启动状态给出机器可读错误
            status = (await client.get("/api/v1/system/startup-status")).json()
            assert status["phase"] == "maintenance"
            assert status["error"]["code"] == "migration-failed"
            # 业务 API 一律 503（含未鉴权路由）
            for path in ("/api/v1/auth/login", "/api/v1/sources", "/api/v1/system/capabilities"):
                response = await client.get(path)
                assert response.status_code == 503, path
                assert response.json()["error"]["code"] == "migration-failed"
            # 根路径仍可访问（诊断入口）
            assert (await client.get("/")).status_code == 200

    # 队列/引擎从未构建
    assert getattr(app.state, "job_queue", None) is None
    assert getattr(app.state, "engine_manager", None) is None


@pytest.mark.asyncio
async def test_engine_data_gate_failure_reports_specific_code(monkeypatch, tmp_path):
    from sag_api import main as main_module
    from sag_api.sag import engine_data_version as edv

    def _incompatible(_engine_dir):
        raise edv.EngineDataIncompatible("数据由更新版本创建")

    monkeypatch.setattr(edv, "verify_and_upgrade_engine_data", _incompatible)
    app = main_module.create_app()
    transport = httpx.ASGITransport(app=app)

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            status = (await client.get("/api/v1/system/startup-status")).json()
            assert status["phase"] == "maintenance"
            assert status["error"]["code"] == "engine-data-incompatible"


@pytest.mark.asyncio
async def test_ready_phase_serves_business_api():
    """对照组：正常启动时业务路由不被门禁拦截。"""
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            assert (await client.get("/api/v1/system/ready")).status_code == 200
            status = (await client.get("/api/v1/system/startup-status")).json()
            assert status["phase"] == "ready"
            # 业务路由可达（鉴权失败是 401 而不是维护 503）
            assert (await client.get("/api/v1/sources")).status_code in (401, 403)
