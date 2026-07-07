"""HTTP 层冒烟：跑真实 ASGI 应用（含 lifespan / 后台队列），全程离线。"""

import httpx
import pytest


@pytest.mark.asyncio
async def test_end_to_end_offline():
    from muse_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            # 系统
            assert (await c.get("/api/v1/system/health")).json()["status"] == "ok"
            caps = (await c.get("/api/v1/system/capabilities")).json()
            assert caps["llm_configured"] is False

            # 认证：首用户 admin
            r = await c.post(
                "/api/v1/auth/register",
                json={"email": "a@b.com", "password": "password123", "name": "Ada"},
            )
            assert r.status_code == 201
            tok = r.json()["access_token"]
            assert r.json()["user"]["role"] == "admin"
            H = {"Authorization": f"Bearer {tok}"}

            assert (await c.get("/api/v1/auth/me", headers=H)).json()["email"] == "a@b.com"
            assert (await c.get("/api/v1/auth/me")).status_code == 401
            dup = await c.post(
                "/api/v1/auth/register", json={"email": "a@b.com", "password": "password123"}
            )
            assert dup.status_code == 409

            # 连接器 + 信源
            conns = (await c.get("/api/v1/sources/connectors", headers=H)).json()
            assert any(x["kind"] == "file_upload" for x in conns)
            r = await c.post("/api/v1/sources", headers=H, json={"name": "手册"})
            assert r.status_code == 201
            sid = r.json()["id"]

            # 上传（不等待后台完成，避免 401 重试拖慢测试）
            up = await c.post(
                f"/api/v1/sources/{sid}/documents",
                headers=H,
                files={"file": ("a.md", b"# T\n\nhello world\n", "text/markdown")},
            )
            assert up.status_code == 201 and up.json()["status"] == "pending"
            assert (await c.get("/api/v1/sources", headers=H)).json()[0]["document_count"] == 1

            # 未配置 LLM 时问答 → 400
            th = (
                await c.post(
                    f"/api/v1/sources/{sid}/threads", headers=H, json={"source_id": sid}
                )
            ).json()
            ask = await c.post(
                f"/api/v1/sources/{sid}/threads/{th['id']}/ask",
                headers=H,
                json={"query": "hi"},
            )
            assert ask.status_code == 400
