"""答案生成的提示词与引用构造。"""

from __future__ import annotations

from typing import Any

from sag_api.sag import RetrievedSection

_SYSTEM = {
    "zh": (
        "你是 sag，一个带知识库的智能助手。自然对话，按需用工具。\n"
        "何时用工具：\n"
        "- 寒暄、闲聊、翻译、改写、通用常识——直接回答，**不要调用工具**。\n"
        "- 涉及用户资料/知识库内容、具体事实核查——先调用 search_context 检索；"
        "结果不足时换角度改写查询（同义词/上位词/具体化）再搜，必要时用 get_entity 澄清人物或概念；"
        "证据足够即停，不做无谓调用。\n"
        "如何作答：\n"
        "- 用了检索就只依据检索到的资料，不编造；检索不到时直说「资料中未提及」，"
        "并说明已试过的角度。\n"
        "- 证据编号全局递增（跨多轮工具调用连续，如 [4][5]），在关键论断处标注 [序号]，"
        "不要虚构编号；没有调用工具的回答不要带编号。\n"
        "- 简洁、结构化（要点/短段落）。"
    ),
    "en": (
        "You are sag, an assistant with a knowledge base. Converse naturally; use tools only when needed.\n"
        "When to use tools:\n"
        "- Greetings, chit-chat, translation, rewriting, general knowledge — answer directly, no tools.\n"
        "- Questions about the user's documents or fact-checking — call search_context first; "
        "if results are thin, rewrite the query from new angles and search again, "
        "or use get_entity for clarification; stop once evidence suffices.\n"
        "How to answer:\n"
        "- When you searched, answer only from retrieved sources; say plainly when nothing relevant was found.\n"
        "- Evidence numbering is global across tool calls; cite [n] at key claims, never invent indices; "
        "tool-free answers carry no citations.\n"
        "- Be concise and structured."
    ),
}

_USER_TEMPLATE = {
    "zh": "资料：\n{context}\n\n问题：{query}\n\n请依据资料作答，并在相应位置用 [序号] 标注引用。",
    "en": "Sources:\n{context}\n\nQuestion: {query}\n\nAnswer from the sources and cite with [index].",
}


def estimate_tokens(text: str) -> int:
    """CJK 感知的 token 估算：中日韩 ≈1/字，其余 ≈1/4 字符（与前端口径一致）。"""
    cjk = sum(1 for ch in text if "\u3000" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff")
    return cjk + max(0, (len(text) - cjk) + 3) // 4


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


def build_agent_messages(
    name: str,
    persona: dict[str, Any],
    query: str,
    *,
    history: list[dict[str, str]] | None = None,
    language: str = "zh",
    attachments: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """注入灵魂人格的对话提示词（agent-first：无预置资料区，检索由工具按需完成）。"""
    lang = language if language in _SYSTEM else "zh"
    persona = persona or {}
    parts = [persona.get("system_prompt") or f"你是{name}。", _SYSTEM[lang]]
    guardrails = persona.get("guardrails") or []
    if guardrails:
        parts.append("约束：" + "；".join(guardrails))
    empty_response = (persona.get("empty_response") or "").strip()
    if empty_response:
        parts.append(f"若检索后仍无相关资料，用这句话回应：「{empty_response}」")
    messages: list[dict[str, str]] = [{"role": "system", "content": "\n\n".join(parts)}]
    if history:
        messages.extend(history)
    user_text = query
    if attachments:
        # 视觉输入：OpenAI 兼容 content parts（图片读盘转 data URL；历史轮仅保留文本）
        import base64

        content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
        for att in attachments:
            path, media_type = att.get("path"), att.get("media_type", "image/png")
            if not path:
                continue
            try:
                with open(path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
            except OSError:
                continue
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}}
            )
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": user_text})
    return messages


def build_prompt_preview(messages: list[dict[str, Any]], *, limit: int = 1600) -> str:
    """把发给模型的消息拼成可读预览（用于「查看本轮 prompt」透明化）。

    多模态消息（content 为 parts 列表）：文本部分原样、图片以占位符呈现（不吐 base64）。
    """
    lines: list[str] = []
    role_label = {"system": "系统", "user": "用户", "assistant": "助手", "tool": "工具"}
    for m in messages:
        label = role_label.get(m.get("role", ""), m.get("role", ""))
        content = m.get("content", "")
        if isinstance(content, list):
            texts = [p.get("text", "") for p in content if p.get("type") == "text"]
            images = sum(1 for p in content if p.get("type") == "image_url")
            content = "\n".join(texts) + (f"\n〔附图 ×{images}〕" if images else "")
        lines.append(f"【{label}】\n{content}")
    text = "\n\n".join(lines)
    if len(text) > limit:
        text = text[:limit].rstrip() + "\n\n…（已截断）"
    return text


def build_citations(
    sections: list[RetrievedSection],
    source_refs: dict[str, dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    """由检索段落确定性地构造引用列表（编号与 prompt 中一致）。

    `source_refs`：{sag_source_config_id: {"id": sag 信源 id, "name": 信源名}}。
    对外的 `source_id` 一律指 **sag 信源 id**（可直接路由 / 取原文），不泄漏引擎内部 id。
    """
    citations = []
    for i, s in enumerate(sections, start=1):
        snippet = s.content.strip().replace("\n", " ")
        if len(snippet) > 240:
            snippet = snippet[:240].rstrip() + "…"
        ref = (source_refs or {}).get(s.source_config_id or "") or {}
        citations.append(
            {
                "n": i,
                "chunk_id": s.chunk_id,
                "heading": s.heading,
                "snippet": snippet,
                "score": round(s.score, 4),
                "source_id": ref.get("id"),
                "source_name": ref.get("name"),
            }
        )
    return citations
