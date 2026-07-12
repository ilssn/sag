"""Exercise aggregate overview and keyset expansion against the real graph store."""

import asyncio
import uuid
from datetime import datetime, timedelta

import httpx
import pytest


@pytest.mark.asyncio
async def test_universe_real_store_statistics_and_keyset_cursor():
    from sag_api.core.db import SessionLocal
    from sag_api.db.models import Source
    from sag_api.main import app

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            token = (
                await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"universe-engine-{uuid.uuid4().hex}@t.com",
                        "password": "password123",
                    },
                )
            ).json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            source_body = (
                await client.post(
                    "/api/v1/sources",
                    headers=headers,
                    json={"name": "时序图谱测试源"},
                )
            ).json()
            source_id = source_body["id"]
            async with SessionLocal() as session:
                source = await session.get(Source, source_id)
                assert source is not None
                source_config_id = source.sag_source_config_id

            from zleap.sag.db import get_session_factory
            from zleap.sag.db.models import (
                Entity,
                EntityType,
                EventEntity,
                SourceConfig,
                SourceEvent,
            )

            entity_id = uuid.uuid4().hex
            auxiliary_entity_ids: list[str] = []
            entity_type_id = uuid.uuid4().hex
            event_ids: list[str] = []
            old_event_id = uuid.uuid4().hex
            base_time = datetime.now() - timedelta(days=1)
            session_factory = get_session_factory()
            async with session_factory() as session:
                await session.merge(SourceConfig(id=source_config_id, name="时序图谱测试源"))
                session.add(
                    EntityType(
                        id=entity_type_id,
                        type=f"concept_{entity_type_id[:8]}",
                        name="概念",
                    )
                )
                session.add(
                    Entity(
                        id=entity_id,
                        source_config_id=source_config_id,
                        entity_type_id=entity_type_id,
                        type="concept",
                        name="SAG 动态图谱",
                        normalized_name="sag动态图谱",
                        description="有界、按需生长的知识图谱",
                    )
                )
                await session.flush()
                for index in range(23):
                    event_id = uuid.uuid4().hex
                    event_ids.append(event_id)
                    # 每三条共享同一时间，验证复合游标的稳定 tie-break。
                    event_time = base_time - timedelta(days=index // 3)
                    session.add(
                        SourceEvent(
                            id=event_id,
                            source_config_id=source_config_id,
                            source_type="doc",
                            source_id="timeline-doc",
                            title=f"时序事件 {index:02d}",
                            summary="按时间和 ID 稳定分页。",
                            content="测试内容",
                            category="时序测试",
                            chunk_id=f"chunk-{index}",
                            start_time=event_time,
                            created_time=event_time,
                        )
                    )
                    session.add(
                        EventEntity(
                            id=uuid.uuid4().hex,
                            event_id=event_id,
                            entity_id=entity_id,
                            weight=1.0,
                        )
                    )
                for index in range(10):
                    auxiliary_id = uuid.uuid4().hex
                    auxiliary_entity_ids.append(auxiliary_id)
                    session.add(
                        Entity(
                            id=auxiliary_id,
                            source_config_id=source_config_id,
                            entity_type_id=entity_type_id,
                            type="concept",
                            name=f"关联主题 {index:02d}",
                            normalized_name=f"关联主题{index:02d}",
                            description="用于验证实体优先的时间分页。",
                        )
                    )
                    session.add(
                        EventEntity(
                            id=uuid.uuid4().hex,
                            event_id=event_ids[1],
                            entity_id=auxiliary_id,
                            weight=0.5,
                        )
                    )
                old_event_time = base_time - timedelta(days=500)
                session.add(
                    SourceEvent(
                        id=old_event_id,
                        source_config_id=source_config_id,
                        source_type="doc",
                        source_id="timeline-doc",
                        title="较早的历史事件",
                        summary="应通过实体关系的游标分页继续抵达。",
                        content="测试内容",
                        category="时序测试",
                        chunk_id="chunk-old",
                        start_time=old_event_time,
                        created_time=old_event_time,
                    )
                )
                session.add(
                    EventEntity(
                        id=uuid.uuid4().hex,
                        event_id=old_event_id,
                        entity_id=entity_id,
                        weight=1.0,
                    )
                )
                await session.commit()

            rebuilt = await client.post("/api/v1/universe/rebuild", headers=headers)
            assert rebuilt.status_code == 202, rebuilt.text
            for _ in range(500):
                job_response = await client.get(
                    f"/api/v1/jobs/{rebuilt.json()['id']}", headers=headers
                )
                assert job_response.status_code == 200, job_response.text
                if job_response.json()["status"] in {"succeeded", "failed"}:
                    break
                await asyncio.sleep(0.01)
            assert job_response.json()["status"] == "succeeded", job_response.text
            rebuilt = await client.get("/api/v1/universe/manifest", headers=headers)
            assert rebuilt.status_code == 200, rebuilt.text
            partition = next(
                item
                for item in rebuilt.json()["partitions"]
                if item["kind"] == "source" and item["source_id"] == source_id
            )
            assert partition["event_count"] == 24
            assert partition["entity_count"] == 11
            assert partition["relation_count"] == 34
            assert sum(bucket["count"] for bucket in partition["time_buckets"]) == 24
            assert rebuilt.json()["policy"]["timeline_event_page_size"] == 8
            assert rebuilt.json()["policy"]["event_entity_limit"] == 96

            full_entities = await client.post(
                "/api/v1/universe/activate",
                headers=headers,
                json={
                    "epoch": 9,
                    "source_id": source_id,
                    "category": "concept",
                    "limit": 48,
                },
            )
            assert full_entities.status_code == 200, full_entities.text
            assert full_entities.json()["seed_kind"] == "entity"
            assert len(full_entities.json()["nodes"]) == 11
            assert {node["kind"] for node in full_entities.json()["nodes"]} == {"entity"}
            assert entity_id in {node["id"] for node in full_entities.json()["nodes"]}
            primary_entity = next(
                node for node in full_entities.json()["nodes"] if node["id"] == entity_id
            )
            assert primary_entity["related_count"] == 24

            recent_entities = await client.post(
                "/api/v1/universe/activate",
                headers=headers,
                json={
                    "epoch": 9,
                    "source_id": source_id,
                    "category": "concept",
                    "limit": 48,
                    "after": (base_time - timedelta(days=30)).isoformat(),
                },
            )
            assert recent_entities.status_code == 200, recent_entities.text
            assert len(recent_entities.json()["nodes"]) == 11

            activated = await client.post(
                "/api/v1/universe/activate",
                headers=headers,
                json={
                    "epoch": 10,
                    "source_id": source_id,
                    "category": "concept",
                    "limit": 7,
                },
            )
            assert activated.status_code == 200, activated.text
            assert activated.json()["epoch"] == 10
            assert len(activated.json()["nodes"]) == 7
            assert activated.json()["has_more"] is True

            async def activate(cursor: str | None = None):
                response = await client.post(
                    "/api/v1/universe/activate",
                    headers=headers,
                    json={
                        "epoch": 10,
                        "source_id": source_id,
                        "category": "concept",
                        "limit": 7,
                        "cursor": cursor,
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()

            activation_pages = [activated.json()]
            while activation_pages[-1]["page"]["has_more"]:
                activation_pages.append(
                    await activate(activation_pages[-1]["page"]["next_cursor"])
                )
            assert [page["page"]["returned"] for page in activation_pages] == [7, 4]
            activation_ids = [
                node["id"]
                for page in activation_pages
                for node in page["nodes"]
            ]
            assert len(activation_ids) == len(set(activation_ids)) == 11
            assert set(activation_ids) == {entity_id, *auxiliary_entity_ids}

            async def timeline(cursor: str | None = None):
                response = await client.post(
                    "/api/v1/universe/timeline",
                    headers=headers,
                    json={
                        "epoch": 10,
                        "source_id": source_id,
                        "limit": 7,
                        "cursor": cursor,
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()

            timeline_pages = [await timeline()]
            while timeline_pages[-1]["page"]["has_more"]:
                timeline_pages.append(
                    await timeline(timeline_pages[-1]["page"]["next_cursor"])
                )
            assert [page["page"]["returned"] for page in timeline_pages] == [7, 7, 7, 3]
            timeline_events = [
                node["id"]
                for page in timeline_pages
                for node in page["nodes"]
                if node["kind"] == "event"
            ]
            assert len(timeline_events) == len(set(timeline_events)) == 24
            assert set(timeline_events) == {*event_ids, old_event_id}
            assert timeline_events[-1] == old_event_id
            assert sum(len(page["relations"]) for page in timeline_pages) == 34
            assert max(
                node["related_count"]
                for page in timeline_pages
                for node in page["nodes"]
                if node["kind"] == "event"
            ) == 11
            for page in timeline_pages:
                event_ids_in_page = {
                    node["id"] for node in page["nodes"] if node["kind"] == "event"
                }
                entity_ids_in_page = {
                    node["id"] for node in page["nodes"] if node["kind"] == "entity"
                }
                assert all(
                    relation["from_id"] in event_ids_in_page
                    for relation in page["relations"]
                )
                assert all(
                    relation["to_id"] in entity_ids_in_page
                    for relation in page["relations"]
                )
                event_counts = {
                    node["id"]: node["related_count"]
                    for node in page["nodes"]
                    if node["kind"] == "event"
                }
                assert all(
                    sum(
                        1
                        for relation in page["relations"]
                        if relation["from_id"] == event_id
                    )
                    == event_counts[event_id]
                    for event_id in event_ids_in_page
                )

            mismatched_activation = await client.post(
                "/api/v1/universe/activate",
                headers=headers,
                json={
                    "epoch": 10,
                    "source_id": source_id,
                    "category": "other",
                    "limit": 7,
                    "cursor": activation_pages[0]["page"]["next_cursor"],
                },
            )
            assert mismatched_activation.status_code == 422

            async def expand(cursor: str | None = None, node_id: str = entity_id):
                response = await client.post(
                    "/api/v1/universe/expand",
                    headers=headers,
                    json={
                        "epoch": 11,
                        "source_id": source_id,
                        "node_kind": "entity",
                        "node_id": node_id,
                        "limit": 10,
                        "cursor": cursor,
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()

            first = await expand()
            assert first["anchor"]["related_count"] == 24
            second = await expand(first["page"]["next_cursor"])
            third = await expand(second["page"]["next_cursor"])
            assert [first["page"]["returned"], second["page"]["returned"], third["page"]["returned"]] == [10, 10, 4]
            assert third["page"]["has_more"] is False
            assert third["page"]["next_cursor"] is None
            paged_ids = [
                node["id"]
                for page in (first, second, third)
                for node in page["nodes"]
                if node["kind"] == "event"
            ]
            assert len(paged_ids) == len(set(paged_ids)) == 24
            assert set(paged_ids) == {*event_ids, old_event_id}
            assert set(auxiliary_entity_ids).issubset(
                {
                    node["id"]
                    for page in (first, second, third)
                    for node in page["nodes"]
                    if node["kind"] == "entity"
                }
            )
            for page in (first, second, third):
                page_event_ids = {
                    node["id"] for node in page["nodes"] if node["kind"] == "event"
                }
                page_entity_ids = {
                    node["id"] for node in page["nodes"] if node["kind"] == "entity"
                } | {entity_id}
                assert all(
                    relation["from_id"] in page_event_ids
                    and relation["to_id"] in page_entity_ids
                    for relation in page["relations"]
                )

            wrong_anchor = await client.post(
                "/api/v1/universe/expand",
                headers=headers,
                json={
                    "epoch": 11,
                    "source_id": source_id,
                    "node_kind": "entity",
                    "node_id": uuid.uuid4().hex,
                    "limit": 10,
                    "cursor": first["page"]["next_cursor"],
                },
            )
            assert wrong_anchor.status_code == 422

            cursor = first["page"]["next_cursor"]
            assert cursor
            tampered = f"{cursor[:-1]}{'A' if cursor[-1] != 'A' else 'B'}"
            tampered_response = await client.post(
                "/api/v1/universe/expand",
                headers=headers,
                json={
                    "epoch": 11,
                    "source_id": source_id,
                    "node_kind": "entity",
                    "node_id": entity_id,
                    "limit": 10,
                    "cursor": tampered,
                },
            )
            assert tampered_response.status_code == 422

            invalid_window = await client.post(
                "/api/v1/universe/expand",
                headers=headers,
                json={
                    "epoch": 11,
                    "source_id": source_id,
                    "node_kind": "entity",
                    "node_id": entity_id,
                    "after": "2026-07-12T00:00:00Z",
                    "before": "2026-01-01T00:00:00Z",
                },
            )
            assert invalid_window.status_code == 422

            event_expand = await client.post(
                "/api/v1/universe/expand",
                headers=headers,
                json={
                    "epoch": 11,
                    "source_id": source_id,
                    "node_kind": "event",
                    "node_id": event_ids[0],
                    "limit": 1,
                },
            )
            assert event_expand.status_code == 200, event_expand.text
            assert event_expand.json()["anchor"]["related_count"] == 1
            assert event_expand.json()["nodes"][0]["id"] == entity_id
            assert event_expand.json()["page"]["has_more"] is False
