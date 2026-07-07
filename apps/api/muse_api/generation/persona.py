"""从实体相关资料自动生成灵魂人格（书 → 人物）。"""

from __future__ import annotations

from typing import Any

from muse_api.generation.llm import LLMClient

_PROMPT = {
    "zh": (
        "根据以下关于「{name}」的资料，为其撰写一段**第一人称**的人格设定（system prompt）。要求：\n"
        "- 以 {name} 的身份、语气、立场说话；\n"
        "- 只依据这些资料，不臆造事实；\n"
        "- 50–120 字，凝练有性格。\n\n资料：\n{context}\n\n直接输出人格设定文本，不要解释。"
    ),
    "en": (
        "From the material about \"{name}\" below, write a **first-person** persona (system prompt): "
        "speak as {name}, in their voice and stance; rely only on the material; 40–90 words.\n\n"
        "Material:\n{context}\n\nOutput only the persona text."
    ),
}


async def generate_persona(
    llm: LLMClient, name: str, snippets: list[str], *, language: str = "zh"
) -> dict[str, Any]:
    """用 LLM 依据实体资料起草人格；无资料 / 未配置 LLM 时回退到朴素模板。"""
    fallback = {
        "system_prompt": f"你是{name}。以第一人称、依据原始资料作答。",
        "greeting": f"我是{name}。",
        "guardrails": ["只依据原始资料中的情节与设定作答", "保持人物的语气与立场"],
    }
    if not snippets or not llm.configured:
        return fallback
    lang = language if language in _PROMPT else "zh"
    context = "\n".join(f"- {s}" for s in snippets[:15])
    try:
        text = await llm.complete(
            [{"role": "user", "content": _PROMPT[lang].format(name=name, context=context)}]
        )
    except Exception:  # noqa: BLE001 - 生成失败则回退
        return fallback
    text = (text or "").strip()
    if not text:
        return fallback
    return {
        "system_prompt": text,
        "greeting": f"我是{name}。有何见教？",
        "guardrails": ["只依据原始资料中的情节与设定作答", "保持人物的语气与立场"],
    }
