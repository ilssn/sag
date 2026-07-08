"""实体读路径：注入事件—实体图谱后验证 entities 端点（离线）。"""

import uuid

import httpx
import pytest


@pytest.mark.asyncio
async def test_entity_read_path():
    from zleap_api.core.db import SessionLocal
    from zleap_api.db.models import Source
    from zleap_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            tok = (
                await c.post(
                    "/api/v1/auth/register", json={"email": "book@x.com", "password": "password123"}
                )
            ).json()["access_token"]
            H = {"Authorization": f"Bearer {tok}"}

            src = (await c.post("/api/v1/sources", headers=H, json={"name": "三国演义"})).json()
            sid = src["id"]
            async with SessionLocal() as s:
                scid = (await s.get(Source, sid)).sag_source_config_id

            # 注入事件—实体图谱（模拟 extract 产物）
            from zleap.sag.db import get_session_factory
            from zleap.sag.db.models import Entity, EntityType, EventEntity, SourceConfig, SourceEvent

            sf = get_session_factory()
            async with sf() as s:
                await s.merge(SourceConfig(id=scid, name="三国演义"))
                et = EntityType(id=uuid.uuid4().hex, type="person", name="人物")
                s.add(et)
                await s.flush()
                ent = Entity(
                    id=uuid.uuid4().hex,
                    source_config_id=scid,
                    entity_type_id=et.id,
                    type="person",
                    name="关羽",
                    normalized_name="关羽",
                    description="蜀汉名将",
                )
                s.add(ent)
                await s.flush()
                ev = SourceEvent(
                    id=uuid.uuid4().hex,
                    source_config_id=scid,
                    source_type="doc",
                    source_id="d1",
                    title="过五关斩六将",
                    summary="关羽千里走单骑，护送二嫂寻兄。",
                    content="关羽过五关斩六将。",
                )
                s.add(ev)
                await s.flush()
                s.add(EventEntity(id=uuid.uuid4().hex, event_id=ev.id, entity_id=ent.id, weight=1.0))
                await s.commit()

            # 读实体（带热度）
            ents = (await c.get(f"/api/v1/sources/{sid}/entities?types=person", headers=H)).json()
            assert any(e["name"] == "关羽" and e["heat"] >= 1 for e in ents)
