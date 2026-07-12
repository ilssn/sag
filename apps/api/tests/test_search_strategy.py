"""全局搜索只公开快速/精确两档，并始终保持信源 fan-out 边界。"""

import asyncio
import uuid

import httpx
import pytest
from sqlalchemy import delete


async def _register(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": "search-strategy@t.com", "password": "password123"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.mark.asyncio
async def test_global_search_forwards_validated_strategy():
    from sag_api.core.deps import get_engine_manager
    from sag_api.main import app
    from sag_api.sag.dto import (
        EntityInfo,
        GraphAssociationInfo,
        GraphEventInfo,
        RetrievedSection,
        SearchOutcome,
        SourceGraphInfo,
    )

    class RecordingEngine:
        strategy: str | None = None
        top_k: int | None = None

        async def provision(self, *_args):
            return None

        async def search_many(self, targets, query, *, strategy=None, top_k=None):
            self.strategy = strategy
            self.top_k = top_k
            source_config_id = targets[0][0]
            return SearchOutcome(
                query=query,
                sections=[
                    RetrievedSection(
                        chunk_id="chunk-1",
                        heading="原始分块标题",
                        content="原始分块正文",
                        score=0.82,
                        source_config_id=source_config_id,
                    )
                ],
                stats={"strategy": strategy},
            )

        async def graph_for_sections(self, sections, sources_by_config, **_kwargs):
            source_config_id = sections[0].source_config_id
            return SourceGraphInfo(
                events=[
                    GraphEventInfo(
                        id="event-1",
                        source_config_id=source_config_id,
                        source_id="document-1",
                        chunk_id="chunk-1",
                        title="外卖骑手收入变化",
                        summary="报告分析了工作时长、技能与收入之间的关系。",
                        category="劳动研究",
                        score=0.82,
                    )
                ],
                entities=[
                    EntityInfo(
                        id="entity-1",
                        name="外卖骑手",
                        type="职业",
                        description="平台配送劳动者",
                        heat=1,
                    )
                ],
                associations=[
                    GraphAssociationInfo(event_id="event-1", entity_id="entity-1")
                ],
            )

    engine = RecordingEngine()
    app.dependency_overrides[get_engine_manager] = lambda: engine
    try:
        transport = httpx.ASGITransport(app=app)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
                headers = await _register(client)
                source = await client.post(
                    "/api/v1/sources",
                    headers=headers,
                    json={"name": "检索策略测试源"},
                )
                assert source.status_code == 201, source.text

                response = await client.post(
                    "/api/v1/search",
                    headers=headers,
                    json={
                        "query": "策略测试",
                        "source_ids": [source.json()["id"]],
                        "strategy": "multi",
                        "top_k": 7,
                    },
                )
                assert response.status_code == 200, response.text
                assert engine.strategy == "multi"
                # 对外仍返回 7 条；内部有界扩大候选池，之后统一重排与过滤。
                assert engine.top_k == 21
                assert response.json()["stats"]["strategy"] == "multi"
                result = response.json()
                assert result["stats"]["requested_top_k"] == 7
                assert result["stats"]["candidate_top_k"] == 21
                assert "[1]" in result["summary"]
                assert result["events"][0]["title"] == "外卖骑手收入变化"
                assert result["events"][0]["summary"].startswith("报告分析")
                assert result["events"][0]["source_id"] == source.json()["id"]
                assert result["entities"][0]["name"] == "外卖骑手"
                assert result["relations"][0]["kind"] == "mentions"

                deprecated = await client.post(
                    "/api/v1/search",
                    headers=headers,
                    json={"query": "策略测试", "strategy": "atomic"},
                )
                assert deprecated.status_code == 422

                invalid = await client.post(
                    "/api/v1/search",
                    headers=headers,
                    json={"query": "策略测试", "strategy": "unknown"},
                )
                assert invalid.status_code == 422
    finally:
        app.dependency_overrides.pop(get_engine_manager, None)


@pytest.mark.asyncio
async def test_search_many_caps_candidates_and_concurrency(monkeypatch):
    from sag_api.core.config import settings
    from sag_api.sag.dto import SearchOutcome
    from sag_api.sag.engine_manager import EngineManager

    monkeypatch.setattr(settings, "search_source_candidate_limit", 2)
    monkeypatch.setattr(settings, "search_source_concurrency", 1)
    manager = EngineManager(settings)
    active = 0
    peak = 0
    calls: list[str] = []

    async def fake_search(source_config_id, query, **_kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        calls.append(source_config_id)
        await asyncio.sleep(0)
        active -= 1
        return SearchOutcome(query=query, sections=[])

    monkeypatch.setattr(manager, "search", fake_search)
    outcome = await manager.search_many(
        [(f"source-{index}", None) for index in range(5)],
        "有界检索",
    )

    assert calls == ["source-0", "source-1"]
    assert peak == 1
    assert outcome.stats == {
        "sources": 2,
        "sources_requested": 5,
        "source_limit_applied": True,
        "candidates": 0,
    }


@pytest.mark.asyncio
async def test_search_source_candidates_use_database_limit_and_explicit_order(monkeypatch):
    from sag_api.core.config import settings
    from sag_api.core.db import SessionLocal
    from sag_api.core.errors import ValidationError
    from sag_api.db.models import Source
    from sag_api.main import app
    from sag_api.services.source_service import search_source_candidates

    monkeypatch.setattr(settings, "search_source_candidate_limit", 2)
    ids = [uuid.uuid4().hex for _ in range(3)]
    async with app.router.lifespan_context(app):
        async with SessionLocal() as session:
            session.add_all(
                [
                    Source(
                        id=source_id,
                        name=f"候选源 {index}",
                        sag_source_config_id=f"candidate-{source_id}",
                        chunk_count=10_000 + index,
                        event_count=index,
                    )
                    for index, source_id in enumerate(ids)
                ]
            )
            await session.commit()

            implicit = await search_source_candidates(session)
            explicit = await search_source_candidates(session, [ids[0], ids[2]])
            with pytest.raises(ValidationError) as captured:
                await search_source_candidates(session, ids)

            assert [source.id for source in implicit] == [ids[2], ids[1]]
            assert [source.id for source in explicit] == [ids[0], ids[2]]
            assert captured.value.code == "too_many_search_sources"

            await session.execute(delete(Source).where(Source.id.in_(ids)))
            await session.commit()
