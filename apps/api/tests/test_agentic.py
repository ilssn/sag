"""Agentic 基建：默认工具、全局证据编号、历史压缩、token 估算。全离线。"""

import pytest

from sag_api.generation.prompt import estimate_tokens
from sag_api.services.agent_domain import compress_history
from sag_api.services.agent_service import _enabled_tool_names
from sag_api.tools.base import ToolContext
from sag_api.tools.builtin import SearchContextTool


class _A:
    def __init__(self, is_default=False, tools=None):
        self.is_default = is_default
        self.persona = {"tools": tools} if tools is not None else {}


def test_default_agent_gets_builtin_tools():
    assert _enabled_tool_names(_A(is_default=True)) == ["search_context", "get_entity"]
    assert _enabled_tool_names(_A(is_default=False)) == []
    assert _enabled_tool_names(_A(is_default=True, tools=["echo"])) == ["echo"]  # 显式配置优先


def test_estimate_tokens_cjk_aware():
    assert estimate_tokens("你好世界") == 4          # CJK 每字 1
    assert estimate_tokens("abcdefgh") == 2          # ASCII 每 4 字符 1
    assert estimate_tokens("") == 0


@pytest.mark.asyncio
async def test_search_tool_uses_global_citation_offset():
    class _Sec:
        heading = "标题"
        content = "内容"
        chunk_id = "c1"
        source_config_id = "scid"
        score = 0.9

    class _Outcome:
        sections = [_Sec()]

    class _EM:
        async def search_many(self, targets, query, strategy=None, top_k=None):
            return _Outcome()

    class _Src:
        sag_source_config_id = "scid"
        id = "sid"
        name = "源"

    ctx = ToolContext(engine_manager=_EM(), sources=[_Src()], citation_offset=3)
    result = await SearchContextTool().invoke({"query": "q"}, ctx)
    assert "[4]" in result.content            # 编号从 offset+1 开始
    assert result.citations[0]["n"] == 4


@pytest.mark.asyncio
async def test_compress_history_trims_without_llm():
    history = [{"role": "user", "content": "字" * 200} for _ in range(10)]
    out = await compress_history(history, llm=None, budget_tokens=500)
    assert out and out == history[-len(out):]          # 尾部保留
    assert sum(estimate_tokens(m["content"]) for m in out) <= 500 + 200
    # 预算内不动
    same = await compress_history(history[:2], llm=None, budget_tokens=10_000)
    assert same == history[:2]
