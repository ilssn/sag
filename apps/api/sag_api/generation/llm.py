"""OpenAI 兼容的 LLM 客户端 —— 用于答案合成（流式）。

注意：检索由 zleap-sag 负责；本模块只做「拿着检索到的资料生成答案」这一步。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from sag_agent import CancellationToken, ModelChunk, ModelRequest, Usage
from sag_agent import ToolCall as RuntimeToolCall
from sag_api.core.config import Settings
from sag_api.core.errors import ConfigurationError, UpstreamError
from sag_api.core.logging import get_logger

log = get_logger("generation")

Message = dict


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(
            api_key=settings.llm_api_key or "not-configured",
            base_url=settings.llm_base_url,
            # SDK 默认 600s + 重试 2 次 → 网关假死时单步可挂十几分钟；收紧为可配置上界
            timeout=settings.llm_request_timeout,
            max_retries=1,
        )

    @property
    def configured(self) -> bool:
        return self._settings.llm_configured

    def _extra_body(self) -> dict | None:
        """额外请求体：显式配置优先；qwen 系默认关思考（决策/首 token 提速 10 倍级）。"""
        if self._settings.llm_extra_body:
            return self._settings.llm_extra_body
        if "qwen" in (self._settings.llm_model or "").lower():
            return {"enable_thinking": False}
        return None

    def _ensure_configured(self) -> None:
        if not self.configured:
            raise ConfigurationError("尚未配置 LLM（SAG_LLM_API_KEY / SAG_LLM_BASE_URL / SAG_LLM_MODEL）")

    async def stream_turn(
        self,
        request: ModelRequest,
        cancellation: CancellationToken,
    ) -> AsyncIterator[ModelChunk]:
        """Stream one provider turn, including native function calls.

        A direct answer and a tool decision now share one provider request. This is
        the adapter required by sag_agent.ModelProvider.
        """

        self._ensure_configured()
        tool_parts: dict[int, dict[str, str]] = {}
        finish_reason: str | None = None
        try:
            stream = await self._client.chat.completions.create(
                model=self._settings.llm_model,
                messages=[message.to_model_dict() for message in request.messages],  # type: ignore[arg-type]
                temperature=self._settings.llm_temperature,
                max_tokens=self._settings.llm_max_tokens,
                tools=list(request.tools) or None,  # type: ignore[arg-type]
                stream=True,
                extra_body=self._extra_body(),
            )
            async for chunk in stream:
                cancellation.raise_if_cancelled()
                raw_usage = getattr(chunk, "usage", None)
                if raw_usage is not None:
                    prompt_details = getattr(raw_usage, "prompt_tokens_details", None)
                    completion_details = getattr(raw_usage, "completion_tokens_details", None)
                    yield ModelChunk(
                        usage=Usage(
                            input_tokens=int(getattr(raw_usage, "prompt_tokens", 0) or 0),
                            output_tokens=int(getattr(raw_usage, "completion_tokens", 0) or 0),
                            cached_tokens=int(getattr(prompt_details, "cached_tokens", 0) or 0),
                            reasoning_tokens=int(getattr(completion_details, "reasoning_tokens", 0) or 0),
                        )
                    )
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                finish_reason = choice.finish_reason or finish_reason
                delta = choice.delta
                token = getattr(delta, "content", None)
                if token:
                    yield ModelChunk(text_delta=token)
                for fallback_index, tool_delta in enumerate(getattr(delta, "tool_calls", None) or []):
                    index = getattr(tool_delta, "index", None)
                    index = fallback_index if index is None else int(index)
                    part = tool_parts.setdefault(index, {"id": "", "name": "", "arguments": ""})
                    if getattr(tool_delta, "id", None):
                        part["id"] += tool_delta.id
                    function = getattr(tool_delta, "function", None)
                    if function is not None:
                        if getattr(function, "name", None):
                            part["name"] += function.name
                        if getattr(function, "arguments", None):
                            part["arguments"] += function.arguments

            calls: list[RuntimeToolCall] = []
            for index in sorted(tool_parts):
                part = tool_parts[index]
                raw_arguments = part["arguments"] or "{}"
                parse_error = None
                arguments: dict = {}
                try:
                    candidate = json.loads(raw_arguments)
                    if isinstance(candidate, dict):
                        arguments = candidate
                    else:
                        parse_error = "tool arguments must decode to an object"
                except (json.JSONDecodeError, TypeError) as exc:
                    parse_error = str(exc)
                calls.append(
                    RuntimeToolCall(
                        id=part["id"] or f"tool-{request.turn}-{index}",
                        name=part["name"],
                        arguments=arguments,
                        raw_arguments=raw_arguments,
                        parse_error=parse_error,
                    )
                )
            if calls or finish_reason:
                yield ModelChunk(tool_calls=tuple(calls), finish_reason=finish_reason)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("LLM 轮次流式调用失败：%s", e)
            raise UpstreamError(f"生成失败：{e}") from e

    async def complete(self, messages: list[Message]) -> str:
        self._ensure_configured()
        try:
            resp = await self._client.chat.completions.create(
                model=self._settings.llm_model,
                messages=messages,  # type: ignore[arg-type]
                temperature=self._settings.llm_temperature,
                max_tokens=self._settings.llm_max_tokens,
                extra_body=self._extra_body(),
            )
            return resp.choices[0].message.content or ""
        except Exception as e:  # noqa: BLE001
            raise UpstreamError(f"生成失败：{e}") from e
