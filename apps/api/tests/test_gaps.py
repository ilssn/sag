"""P0 修复回归：记忆不泄漏、删除收尾、注册开关。"""

import os

import httpx
import pytest


@pytest.mark.asyncio
async def test_p0_fixes():
    from zleap_api.core.config import settings
    from zleap_api.core.db import SessionLocal
    from zleap_api.db.models import Source
    from zleap_api.main import app
    from zleap_api.services.soul_service import remember_exchange

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            tok = (
                await c.post(
                    "/api/v1/auth/register", json={"email": "gap@x.com", "password": "password123"}
                )
            ).json()["access_token"]
            H = {"Authorization": f"Bearer {tok}"}

            # ── 修复 3 前置：建信源 + 上传，供绑定与删除验证 ──
            src = (await c.post("/api/v1/sources", headers=H, json={"name": "手册"})).json()
            sid = src["id"]
            await c.post(
                f"/api/v1/sources/{sid}/documents",
                headers=H,
                files={"file": ("a.md", b"# t\nhello\n", "text/markdown")},
            )
            upload_dir = os.path.join(settings.upload_dir, sid)
            assert os.path.isdir(upload_dir), "上传目录应已创建"

            soul = (await c.post("/api/v1/souls", headers=H, json={"name": "小助"})).json()
            await c.post(
                f"/api/v1/souls/{soul['id']}/bindings",
                headers=H,
                json={"target_type": "source", "target_id": sid},
            )
            th = (await c.post(f"/api/v1/souls/{soul['id']}/threads", headers=H, json={})).json()

            # ── 修复 1：记忆信源不出现在信源列表 ──
            before = len((await c.get("/api/v1/sources", headers=H)).json())
            await remember_exchange(
                SessionLocal,
                app.state.job_queue,
                soul_id=soul["id"],
                thread_id=th["id"],
                question="hi",
                answer="记住了。",
                upload_dir=settings.upload_dir,
            )
            listed = (await c.get("/api/v1/sources", headers=H)).json()
            assert len(listed) == before, "会话记忆信源不应出现在列表"
            assert all(s["source_type"] != "conversation" for s in listed)

            # ── 修复 2：删除信源 = 绑定清理 + 引擎槽释放 + 上传目录移除 ──
            async with SessionLocal() as s:
                sag_id = (await s.get(Source, sid)).sag_source_config_id
            # 触发一次引擎构造，确保槽位存在
            await app.state.engine_manager.provision(sag_id)
            assert sag_id in app.state.engine_manager._slots

            assert (await c.delete(f"/api/v1/sources/{sid}", headers=H)).status_code == 200
            bindings = (await c.get(f"/api/v1/souls/{soul['id']}/bindings", headers=H)).json()
            assert bindings == [], "指向已删信源的绑定应被清理"
            assert sag_id not in app.state.engine_manager._slots, "引擎槽应已释放"
            assert not os.path.exists(upload_dir), "上传目录应已删除"

            # ── 修复 4/5：注册开关（首个用户后可关闭） ──
            settings.allow_registration = False
            try:
                r = await c.post(
                    "/api/v1/auth/register",
                    json={"email": "second@x.com", "password": "password123"},
                )
                assert r.status_code == 403
            finally:
                settings.allow_registration = True
