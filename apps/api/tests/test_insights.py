"""实体读路径：注入事件—实体图谱后验证 entities 端点（离线）。"""

import uuid

import httpx
import pytest


@pytest.mark.asyncio
async def test_entity_read_path():
    from sag_api.core.db import SessionLocal
    from sag_api.db.models import Document, Source
    from sag_api.enums import DocumentStatus
    from sag_api.main import app

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
                source = await s.get(Source, sid)
                scid = source.sag_source_config_id
                document_id = uuid.uuid4().hex
                s.add(
                    Document(
                        id=document_id,
                        source_id=sid,
                        filename="三国演义.md",
                        content_type="text/markdown",
                        size_bytes=128,
                        storage_path="/tmp/three-kingdoms.md",
                        status=DocumentStatus.READY,
                        chunk_count=1,
                        event_count=1,
                        sag_source_id="d1",
                    )
                )
                source.document_count = 1
                source.chunk_count = 1
                source.event_count = 1
                await s.commit()

            # 注入事件—实体图谱（模拟 extract 产物）
            from zleap.sag.db import get_session_factory
            from zleap.sag.db.models import (
                Article,
                ArticleParseStatus,
                Entity,
                EntityType,
                EventEntity,
                SourceChunk,
                SourceConfig,
                SourceEvent,
            )

            sf = get_session_factory()
            async with sf() as s:
                await s.merge(SourceConfig(id=scid, name="三国演义"))
                s.add(
                    Article(
                        id="d1",
                        source_config_id=scid,
                        source_id="d1",
                        title="三国演义",
                        content="# 三国演义\n\n关羽过五关斩六将。\n",
                        status="COMPLETED",
                        parse_status=ArticleParseStatus.COMPLETED,
                    )
                )
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
                    chunk_id="chunk-1",
                )
                s.add(ev)
                await s.flush()
                event_id = ev.id
                entity_id = ent.id
                s.add(
                    SourceChunk(
                        id="chunk-1",
                        source_config_id=scid,
                        source_type="ARTICLE",
                        source_id="d1",
                        article_id="d1",
                        heading="三国演义",
                        content="关羽过五关斩六将。",
                    )
                )
                s.add(EventEntity(id=uuid.uuid4().hex, event_id=ev.id, entity_id=ent.id, weight=1.0))
                await s.commit()

            parsed = await c.get(
                f"/api/v1/sources/{sid}/documents/{document_id}/parsed",
                headers=H,
            )
            assert parsed.status_code == 200
            assert parsed.headers["content-type"].startswith("text/markdown")
            assert parsed.text == "# 三国演义\n\n关羽过五关斩六将。\n"

            # 读实体（带热度）
            ents = (await c.get(f"/api/v1/sources/{sid}/entities?types=person", headers=H)).json()
            assert any(e["name"] == "关羽" and e["heat"] >= 1 for e in ents)

            # 图谱读路径保留真实文档—事件—实体关系，并返回展示/总量信息。
            response = await c.get(f"/api/v1/sources/{sid}/graph", headers=H)
            assert response.status_code == 200
            graph = response.json()
            assert graph["documents"][0]["id"] == document_id
            assert graph["events"][0]["title"] == "过五关斩六将"
            assert graph["events"][0]["document_id"] == document_id
            assert graph["entities"][0]["name"] == "关羽"
            assert {relation["kind"] for relation in graph["relations"]} == {
                "contains",
                "mentions",
            }
            assert graph["counts"]["shown_relations"] == 2
            assert graph["truncated"] is False

            # 搜索命中分块可稳定映射回事件标题、摘要及真实事件—实体关系。
            from sag_api.sag import RetrievedSection

            search_graph = await app.state.engine_manager.graph_for_sections(
                [
                    RetrievedSection(
                        chunk_id="chunk-1",
                        score=0.91,
                        source_config_id=scid,
                    )
                ],
                {scid: source},
            )
            assert search_graph.events[0].title == "过五关斩六将"
            assert search_graph.events[0].summary.startswith("关羽千里走单骑")
            assert search_graph.events[0].score == pytest.approx(0.91)
            assert search_graph.entities[0].name == "关羽"
            assert search_graph.associations[0].event_id == search_graph.events[0].id

            # 参数有硬上限，避免调用方绕过服务端性能护栏。
            invalid = await c.get(f"/api/v1/sources/{sid}/graph?event_limit=121", headers=H)
            assert invalid.status_code == 422

            # 删除文档必须同步清理统计与引擎中的块、事件及孤立实体。
            deleted = await c.delete(
                f"/api/v1/sources/{sid}/documents/{document_id}",
                headers=H,
            )
            assert deleted.status_code == 200
            source_after_delete = (await c.get(f"/api/v1/sources/{sid}", headers=H)).json()
            assert source_after_delete["document_count"] == 0
            assert source_after_delete["chunk_count"] == 0
            assert source_after_delete["event_count"] == 0
            async with sf() as s:
                assert await s.get(Article, "d1") is None
                assert await s.get(SourceChunk, "chunk-1") is None
                assert await s.get(SourceEvent, event_id) is None
                assert await s.get(Entity, entity_id) is None

            empty_source = (
                await c.post("/api/v1/sources", headers=H, json={"name": "空信源"})
            ).json()
            empty_graph = (
                await c.get(f"/api/v1/sources/{empty_source['id']}/graph", headers=H)
            ).json()
            assert empty_graph["documents"] == []
            assert empty_graph["events"] == []
            assert empty_graph["entities"] == []
            assert empty_graph["relations"] == []
            assert empty_graph["truncated"] is False
