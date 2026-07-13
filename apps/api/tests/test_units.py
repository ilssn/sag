"""快速单元测试：无需网络 / 引擎。"""

from sag_api.connectors import registry
from sag_api.core.config import settings
from sag_api.core.security import hash_password, verify_password
from sag_api.enums import ConnectorKind
from sag_api.generation.prompt import build_agent_messages, build_citations, build_messages
from sag_api.sag import GraphEventInfo, RetrievedSection
from sag_api.sag.config_builder import build_engine_config


def test_password_hash_roundtrip():
    h = hash_password("password123")
    assert verify_password("password123", h)
    assert not verify_password("wrong", h)


def test_connector_registry():
    conn = registry.get(ConnectorKind.FILE_UPLOAD)
    assert conn.meta.kind == ConnectorKind.FILE_UPLOAD
    assert conn.meta.supports_sync is False
    assert any(c.meta.kind == ConnectorKind.FILE_UPLOAD for c in registry.all())


def test_build_engine_config_zero_infra():
    cfg = build_engine_config(settings)
    assert cfg.vector_provider == "lancedb"  # 默认零依赖向量后端
    assert cfg.llm.model == settings.llm_model
    assert cfg.data_dir == settings.data_dir


def test_retrieved_section_from_dict():
    s = RetrievedSection.from_section({"chunk_id": "c1", "heading": "H", "content": "text", "score": 0.9, "rank": 2})
    assert s.chunk_id == "c1" and s.heading == "H" and s.score == 0.9 and s.rank == 2


def test_prompt_and_citations():
    sections = [
        RetrievedSection(
            chunk_id="c1",
            heading="创立",
            content="Acme 由张三创立。这是用于引用预览的补充正文。",
            score=0.8,
            rank=0,
            source_config_id="sc-1",
        )
    ]
    msgs = build_messages("谁创立了 Acme？", sections, language="zh")
    assert msgs[0]["role"] == "system"
    assert "Zleap" in msgs[0]["content"] and "你是 sag" not in msgs[0]["content"]
    assert "[1]" in msgs[-1]["content"] and "Acme" in msgs[-1]["content"]
    cites = build_citations(
        sections,
        events=[
            GraphEventInfo(
                id="event-1",
                source_id="doc-1",
                source_config_id="sc-1",
                chunk_id="c1",
                title="Acme 宣布创立",
                summary="张三完成了 Acme 的创立。",
                category="公司事件",
            )
        ],
    )
    assert cites[0]["n"] == 1 and cites[0]["heading"] == "创立"
    assert cites[0]["snippet"] == "Acme 由张三创立。这是用于引用预览的补充正文。"
    assert "summary" not in cites[0]
    assert cites[0]["event_refs"] == [
        {
            "id": "event-1",
            "title": "Acme 宣布创立",
            "summary": "张三完成了 Acme 的创立。",
            "category": "公司事件",
        }
    ]


def test_citation_events_use_source_and_chunk_composite_key_and_are_bounded():
    sections = [
        RetrievedSection(chunk_id="same", source_config_id="source-a", content="A"),
        RetrievedSection(chunk_id="same", source_config_id="source-b", content="B"),
    ]
    events = [
        GraphEventInfo(
            id=f"a-{index}",
            source_id="doc-a",
            source_config_id="source-a",
            chunk_id="same",
            title=f"A 事件 {index}",
        )
        for index in range(4)
    ] + [
        GraphEventInfo(
            id="b-1",
            source_id="doc-b",
            source_config_id="source-b",
            chunk_id="same",
            title="B 事件",
        )
    ]

    citations = build_citations(sections, events=events)

    assert [item["id"] for item in citations[0]["event_refs"]] == ["a-0", "a-1", "a-2"]
    assert [item["id"] for item in citations[1]["event_refs"]] == ["b-1"]
    assert citations[1]["event_refs"][0]["summary"] == ""
    assert citations[1]["event_refs"][0]["category"] == ""


def test_agent_name_is_injected_into_prompt():
    messages = build_agent_messages(
        "小跃",
        {"system_prompt": "保持严谨。"},
        "你叫什么？",
        language="zh",
    )
    system = messages[0]["content"]
    assert "你的名字是「小跃」" in system
    assert "保持严谨。" in system
    assert "sag" not in system.lower()
