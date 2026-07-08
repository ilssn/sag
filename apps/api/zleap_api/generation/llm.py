"""OpenAI 兼容的 LLM 客户端 —— 用于答案合成（流式）。

注意：检索由 zleap-sag 负责；本模块只做「拿着检索到的资料生成答案」这一步。
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from zleap_api.core.config import Settings
from zleap_api.core.errors import ConfigurationError, UpstreamError
from zleap_api.core.logging import get_logger

log = get_logger("generation")

Message = dict[str, str]


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
