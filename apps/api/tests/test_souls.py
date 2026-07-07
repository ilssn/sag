"""灵魂 HTTP e2e（离线）：CRUD、绑定、会话、ask 守卫、绑定→信源解析。"""

import httpx
import pytest


@pytest.mark.asyncio
async def test_souls_flow_offline():
    from muse_api.core.db import SessionLocal
    from muse_api.db.models import Soul
    from muse_api.main import app
    from muse_api.services.soul_service import resolve_sources

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            tok = (
                await c.post(
                    "/api/v1/auth/register", json={"email": "soul@x.com", "password": "password123"}
                )
            ).json()["access_token"]
            H = {"Authorization": f"Bearer {tok}"}

            ns = (await c.get("/api/v1/namespaces", headers=H)).json()
            knowledge = next(n for n in ns if n["kind"] == "knowledge")

            # 一个信源落在知识空间
            src = (await c.post("/api/v1/sources", headers=H, json={"name": "手册"})).json()

            # 建灵魂（带人格）
            r = await c.post(
                "/api/v1/souls",
                headers=H,
                json={"name": "阿默", "avatar": "阿", "persona": {"system_prompt": "你是阿默。", "top_k": 6}},
            )
            assert r.status_code == 201
            soul = r.json()
            assert soul["name"] == "阿默" and soul["persona"]["top_k"] == 6
            assert soul["memory_namespace_id"]  # 自动挂会话记忆空间
            sid = soul["id"]

            # 绑定知识命名空间
            b = await c.post(
                f"/api/v1/souls/{sid}/bindings",
                headers=H,
                json={"target_type": "namespace", "target_id": knowledge["id"]},
            )
            assert b.status_code == 201
            assert len((await c.get(f"/api/v1/souls/{sid}/bindings", headers=H)).json()) == 1
            # 重复绑定 → 409
            assert (
                await c.post(
                    f"/api/v1/souls/{sid}/bindings",
                    headers=H,
                    json={"target_type": "namespace", "target_id": knowledge["id"]},
                )
            ).status_code == 409

            # 绑定 → 信源解析：应展开出知识空间里的那个源
            async with SessionLocal() as s:
                soul_obj = await s.get(Soul, sid)
                resolved = await resolve_sources(s, soul_obj)
            assert [x.id for x in resolved] == [src["id"]]

            # 会话 + 离线 ask → 400（未配置 LLM）
            th = (await c.post(f"/api/v1/souls/{sid}/threads", headers=H, json={})).json()
            ask = await c.post(
                f"/api/v1/souls/{sid}/threads/{th['id']}/ask", headers=H, json={"query": "你好"}
            )
            assert ask.status_code == 400

            # 列表 + 删除
            assert len((await c.get("/api/v1/souls", headers=H)).json()) == 1
            assert (await c.delete(f"/api/v1/souls/{sid}", headers=H)).status_code == 200
            assert len((await c.get("/api/v1/souls", headers=H)).json()) == 0
