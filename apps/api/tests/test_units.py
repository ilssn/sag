"""快速单元测试：无需网络 / 引擎。"""

from sag_api.connectors import registry
from sag_api.core.config import settings
from sag_api.core.security import hash_password, verify_password
from sag_api.enums import ConnectorKind
from sag_api.generation.prompt import build_citations, build_messages
from sag_api.sag import RetrievedSection
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
    s = RetrievedSection.from_section(
        {"chunk_id": "c1", "heading": "H", "content": "text", "score": 0.9, "rank": 2}
    )
    assert s.chunk_id == "c1" and s.heading == "H" and s.score == 0.9 and s.rank == 2


def test_prompt_and_citations():
    sections = [RetrievedSection(chunk_id="c1", heading="创立", content="Acme 由张三创立", score=0.8, rank=0)]
    msgs = build_messages("谁创立了 Acme？", sections, language="zh")
    assert msgs[0]["role"] == "system"
    assert "[1]" in msgs[-1]["content"] and "Acme" in msgs[-1]["content"]
    cites = build_citations(sections)
    assert cites[0]["n"] == 1 and cites[0]["heading"] == "创立"
