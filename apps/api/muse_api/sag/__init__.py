"""zleap-sag 适配层 —— 全项目唯一 import `zleap-sag` 的地方。

对外只暴露 muse 自己的 DTO 与 `EngineManager`，从而把引擎实现细节与领域逻辑解耦，
未来替换 / 升级引擎时改动收敛在此目录。
"""

from muse_api.sag.dto import EntityInfo, ProcessOutcome, RetrievedSection, SearchOutcome
from muse_api.sag.engine_manager import EngineManager

__all__ = ["EngineManager", "EntityInfo", "ProcessOutcome", "RetrievedSection", "SearchOutcome"]
