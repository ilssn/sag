"""v0.3 客户端形态后端：默认 agent、近期动态、文档原文端点。全程离线。"""

import httpx
import pytest


async def _register(c, email):
    r = await c.post("/api/v1/auth/register", json={"email": email, "password": "password123"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.asyncio
async def test_default_agent_activity_and_document_file():
    from sqlalchemy import select

    from sag_api.core.db import SessionLocal
    from sag_api.db.models import Agent
    from sag_api.main import app
    from sag_api.services.agent_domain import resolve_sources

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            A = await _register(c, "clientform@t.com")

            # 默认 agent：lifespan 已播种；端点 get-or-create 幂等（id 稳定）
            a1 = (await c.get("/api/v1/agents/default", headers=A)).json()
            a2 = (await c.get("/api/v1/agents/default", headers=A)).json()
            assert a1["id"] == a2["id"] and a1["is_default"] is True
            async with SessionLocal() as s:
                defaults = (
                    (await s.execute(select(Agent).where(Agent.is_default.is_(True))))
                    .scalars()
                    .all()
                )
                assert len(defaults) == 1

            # 知识库 = 全部信源：新建信源后无需绑定即被 resolve
            src = (await c.post("/api/v1/sources", headers=A, json={"name": "客户端源"})).json()
            async with SessionLocal() as s:
                agent = await s.get(Agent, a1["id"])
                sources = await resolve_sources(s, agent)
                assert any(x.id == src["id"] for x in sources)

            # 上传一个文档（离线：md 解析入库）
            up = await c.post(
                f"/api/v1/sources/{src['id']}/documents",
                headers=A,
                files={"file": ("hello.md", b"# T\n\nhello sag", "text/markdown")},
            )
            assert up.status_code in (200, 201), up.text
            doc = up.json()

            # 近期动态：包含该文档；thread 建一个后也出现
            t = (await c.post(f"/api/v1/agents/{a1['id']}/threads", headers=A, json={})).json()
            acts = (await c.get("/api/v1/activity", headers=A)).json()
            kinds = {(x["type"], x["id"]) for x in acts}
            assert ("document", doc["id"]) in kinds and ("thread", t["id"]) in kinds
            assert acts == sorted(acts, key=lambda x: x["at"], reverse=True)

            # 原文端点：200 + 内容与上传一致；不存在的 id → 404
            f = await c.get(
                f"/api/v1/sources/{src['id']}/documents/{doc['id']}/file", headers=A
            )
            assert f.status_code == 200 and b"hello sag" in f.content
            nf = await c.get(
                f"/api/v1/sources/{src['id']}/documents/does-not-exist/file", headers=A
            )
            assert nf.status_code == 404
