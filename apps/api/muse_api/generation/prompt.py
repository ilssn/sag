"""答案生成的提示词与引用构造。"""

from __future__ import annotations

from typing import Any

from muse_api.sag import RetrievedSection

_SYSTEM = {
    "zh": (
        "你是 muse 的知识助手。请**只依据下方提供的资料**回答用户问题，"
        "不要编造资料之外的信息。若资料不足以回答，请直白说明「资料中未提及」。"
        "在引用具体内容处，用方括号标注来源序号，如 [1]、[2]。回答简洁、准确、有条理。"
    ),
    "en": (
        "You are muse's knowledge assistant. Answer **only** from the provided sources; "
        "do not fabricate. If the sources are insufficient, say so plainly. "
        "Cite sources inline with bracketed indices like [1], [2]. Be concise and accurate."
    ),
}

_USER_TEMPLATE = {
    "zh": "资料：\n{context}\n\n问题：{query}\n\n请依据资料作答，并在相应位置用 [序号] 标注引用。",
    "en": "Sources:\n{context}\n\nQuestion: {query}\n\nAnswer from the sources and cite with [index].",
}


def _format_context(sections: list[RetrievedSection]) -> str:
    if not sections:
        return "（无相关资料）"
    blocks = []
    for i, s in enumerate(sections, start=1):
        heading = s.heading or "片段"
        blocks.append(f"[{i}] {heading}\n{s.content}")
    return "\n\n".join(blocks)


def build_messages(
    query: str,
    sections: list[RetrievedSection],
    *,
    history: list[dict[str, str]] | None = None,
    language: str = "zh",
) -> list[dict[str, str]]:
    lang = language if language in _SYSTEM else "zh"
    messages: list[dict[str, str]] = [{"role": "system", "content": _SYSTEM[lang]}]
    if history:
        messages.extend(history)
    messages.append(
        {
            "role": "user",
            "content": _USER_TEMPLATE[lang].format(
                context=_format_context(sections), query=query
            ),
        }
    )
    return messages


def build_citations(sections: list[RetrievedSection]) -> list[dict[str, Any]]:
    """由检索段落确定性地构造引用列表（编号与 prompt 中一致）。"""
    citations = []
    for i, s in enumerate(sections, start=1):
        snippet = s.content.strip().replace("\n", " ")
        if len(snippet) > 240:
            snippet = snippet[:240].rstrip() + "…"
        citations.append(
            {
                "n": i,
                "chunk_id": s.chunk_id,
                "heading": s.heading,
                "snippet": snippet,
                "score": round(s.score, 4),
                "source_id": s.source_id,
            }
        )
    return citations
