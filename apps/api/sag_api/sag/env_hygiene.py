"""zleap 依赖包的环境卫生（ADR-0012）。

zleap-sag 的 Settings 会从安装位置向上逐级查找任意 `.env` 并装载
（`_find_project_root()`），这意味着 sidecar 工作目录之上的任何 .env
都可能悄悄注入 `LANCEDB_PATH` / `LLM_BASE_URL` 等配置。逐键防守不可靠，
这里在唯一咽喉处整体禁用 dotenv：引擎配置只允许经
config_builder → apply_config_to_env 的显式通道进入（环境变量优先级
本就高于 dotenv，禁用后 dotenv 通道彻底消失）。

已知残留：litellm 在 import 时会 load_dotenv() 把 CWD 的 .env 注入
os.environ（不覆盖已有值）。sidecar 以受控工作目录运行（冻结包内无 .env），
该通道自然失效；dev 环境保持现状。
"""

from __future__ import annotations

from sag_api.core.logging import get_logger

log = get_logger("env-hygiene")

_applied = False


def disable_zleap_dotenv() -> None:
    """让 zleap 核心 Settings 忽略任何被发现的 .env 文件（幂等）。"""
    global _applied
    if _applied:
        return
    try:
        from zleap.sag.core.config import settings as zleap_settings

        zleap_settings.Settings.model_config["env_file"] = None
        # pydantic-settings 在实例化时读取 env_file；清缓存让后续 get_settings() 生效。
        zleap_settings.get_settings.cache_clear()
        _applied = True
        log.debug("已禁用 zleap .env 装载（引擎配置仅走显式环境变量通道）")
    except Exception:  # noqa: BLE001
        log.warning("无法禁用 zleap .env 装载，依赖包内部结构可能已变化", exc_info=True)
