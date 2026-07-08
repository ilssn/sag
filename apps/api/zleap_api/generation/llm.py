"""OpenAI 兼容的 LLM 客户端 —— 用于答案合成（流式）。

注意：检索由 zleap-sag 负责；本模块只做「拿着检索到的资料生成答案」这一步。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from openai import AsyncOpenAI

from zleap_api.core.config import Settings
from zleap_api.core.errors import ConfigurationError, UpstreamError
from zleap_api.core.logging import get_logger

log = get_logger("generation")

Message = dict


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ChatTurn:
    """一次（非流式）对话轮结果：要么是最终文本，要么是若干工具调用。"""

    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(
            api_key=settings.llm_api_key or "not-configured",
            base_url=settings.llm_base_url,
        )

    @property
    def configured(self) -> bool:
        return self._settings.llm_configured

    def _ensure_configured(self) -> None:
        if not self.configured:
            raise ConfigurationError("尚未配置 LLM（ZLEAP_LLM_API_KEY / ZLEAP_LLM_BASE_URL / ZLEAP_LLM_MODEL）")

    async def stream(self, messages: list[Message]) -> AsyncIterator[str]:
        self._ensure_configured()
        try:
            stream = await self._client.chat.completions.create(
                model=self._settings.llm_model,
                messages=messages,  # type: ignore[arg-type]
                temperature=self._settings.llm_temperature,
                max_tokens=self._settings.llm_max_tokens,
                stream=True,
            )
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                token = getattr(delta, "content", None)
                if token:
                    yield token
        except Exception as e:  # noqa: BLE001
            log.warning("LLM 流式生成失败：%s", e)
            raise UpstreamError(f"生成失败：{e}") from e

    async def complete(self, messages: list[Message]) -> str:
        self._ensure_configured()
        try:
            resp = await self._client.chat.completions.create(
                model=self._settings.llm_model,
                messages=messages,  # type: ignore[arg-type]
                temperature=self._settings.llm_temperature,
                max_tokens=self._settings.llm_max_tokens,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:  # noqa: BLE001
            raise UpstreamError(f"生成失败：{e}") from e

    async def chat(self, messages: list[Message], tools: list[dict] | None = None) -> ChatTurn:
        """非流式对话轮，支持工具调用（native function-calling）。

        返回 ChatTurn：若模型请求调用工具则 `tool_calls` 非空（Agent 循环据此派发），
        否则 `content` 为最终文本。用于 Agent 循环的「决策」步，最终答案仍走 stream()。
        """
        self._ensure_configured()
        try:
            resp = await self._client.chat.completions.create(
                model=self._settings.llm_model,
                messages=messages,  # type: ignore[arg-type]
                temperature=self._settings.llm_temperature,
                max_tokens=self._settings.llm_max_tokens,
                tools=tools or None,  # type: ignore[arg-type]
            )
            msg = resp.choices[0].message
            calls: list[ToolCall] = []
            for tc in getattr(msg, "tool_calls", None) or []:
                fn = tc.function
                try:
                    parsed = json.loads(fn.arguments or "{}")
                except (json.JSONDecodeError, TypeError):
                    parsed = {}
                calls.append(ToolCall(id=tc.id, name=fn.name, arguments=parsed))
            return ChatTurn(content=msg.content, tool_calls=calls)
        except Exception as e:  # noqa: BLE001
            raise UpstreamError(f"生成失败：{e}") from e
