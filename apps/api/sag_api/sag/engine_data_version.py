"""知识索引数据版本门禁（ADR-0015）。

引擎数据（LanceDB + 引擎 SQLite + 事件/实体索引）是昂贵的持久数据，
不是可删缓存。版本记录随数据目录走（marker 文件，而非元数据库——
数据目录被迁移/备份/跨机恢复时记录必须同行）。

门禁规则：
- 无记录 + 空目录  → 首装：写入当前版本记录；
- 无记录 + 有数据  → v0（版本化之前的存量）：按迁移链采纳；
- 记录 == 当前版本 → 校验 zleap-sag 版本受支持后放行；
- 记录 > 当前版本 / 缺迁移路径 / zleap 版本不受支持
                   → EngineDataIncompatible → 维护模式 + 用户指引
                     （升级应用，或显式选择重建索引；绝不静默删数据）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from sag_api import __version__ as app_version
from sag_api.core.config import settings
from sag_api.core.logging import get_logger
from sag_api.core.runtime_state import StartupGateError

log = get_logger("engine-data")

CURRENT_ENGINE_DATA_VERSION = 1
RECORD_FILENAME = "engine_data_version.json"

# 每个桌面发布支持的 zleap-sag 版本（发布前随 uv.lock 固定）。
SUPPORTED_ZLEAP_SAG_VERSIONS = frozenset({"0.7.1"})


class EngineDataIncompatible(StartupGateError):
    def __init__(self, message: str):
        super().__init__("engine-data-incompatible", message, recoverable=False)


@dataclass
class EngineDataRecord:
    engine_data_version: int
    zleap_sag_version: str
    created_by_app: str
    updated_at: str


def _installed_zleap_version() -> str:
    try:
        from zleap.sag import __version__ as zleap_version

        return zleap_version
    except Exception:  # noqa: BLE001 —— 冻结环境读不到时不阻断（记录 unknown）
        return "unknown"


def read_record(engine_dir: Path) -> EngineDataRecord | None:
    path = engine_dir / RECORD_FILENAME
    if not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return EngineDataRecord(
            engine_data_version=int(raw["engine_data_version"]),
            zleap_sag_version=str(raw.get("zleap_sag_version", "unknown")),
            created_by_app=str(raw.get("created_by_app", "unknown")),
            updated_at=str(raw.get("updated_at", "")),
        )
    except (ValueError, KeyError, TypeError) as error:
        raise EngineDataIncompatible(
            f"引擎数据版本记录损坏（{path}）：{error}。"
            "请从备份恢复该文件，或在确认可接受重建的前提下显式重建索引。"
        ) from error


def write_record(engine_dir: Path, record: EngineDataRecord) -> None:
    engine_dir.mkdir(parents=True, exist_ok=True)
    path = engine_dir / RECORD_FILENAME
    path.write_text(
        json.dumps(asdict(record), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _current_record() -> EngineDataRecord:
    return EngineDataRecord(
        engine_data_version=CURRENT_ENGINE_DATA_VERSION,
        zleap_sag_version=_installed_zleap_version(),
        created_by_app=app_version,
        updated_at=datetime.now(UTC).isoformat(),
    )


def _has_engine_data(engine_dir: Path) -> bool:
    if not engine_dir.is_dir():
        return False
    for entry in engine_dir.iterdir():
        if entry.name == RECORD_FILENAME:
            continue
        return True
    return False


def _adopt_legacy_in_place(_engine_dir: Path) -> None:
    """v0 → v1：版本化之前的数据布局即 v1 布局（zleap 0.7.x），就地采纳。"""
    log.info("发现版本化之前的引擎数据，就地采纳为 v%d", CURRENT_ENGINE_DATA_VERSION)


# 版本迁移链：key = 起始版本，执行后视为 key+1。缺链 = 阻断发布（ADR-0015）。
_MIGRATORS: dict[int, Callable[[Path], None]] = {0: _adopt_legacy_in_place}


def verify_and_upgrade_engine_data(engine_dir: Path) -> EngineDataRecord:
    """启动关卡：校验并（必要时）升级引擎数据版本。失败抛 EngineDataIncompatible。"""
    installed = _installed_zleap_version()
    record = read_record(engine_dir)

    if record is None:
        version = 0 if _has_engine_data(engine_dir) else CURRENT_ENGINE_DATA_VERSION
        if version == CURRENT_ENGINE_DATA_VERSION:
            record = _current_record()
            write_record(engine_dir, record)
            log.info("首装：写入引擎数据版本 v%d（zleap-sag %s）", record.engine_data_version, installed)
            return record
        record = EngineDataRecord(
            engine_data_version=0,
            zleap_sag_version="pre-versioning",
            created_by_app="unknown",
            updated_at="",
        )

    if record.engine_data_version > CURRENT_ENGINE_DATA_VERSION:
        raise EngineDataIncompatible(
            f"引擎数据由更新版本创建（数据 v{record.engine_data_version} > 应用支持 v{CURRENT_ENGINE_DATA_VERSION}）。"
            "请升级应用后再打开该数据目录；降级使用需先从对应版本的备份恢复。"
        )

    while record.engine_data_version < CURRENT_ENGINE_DATA_VERSION:
        migrator = _MIGRATORS.get(record.engine_data_version)
        if migrator is None:
            raise EngineDataIncompatible(
                f"缺少引擎数据 v{record.engine_data_version} → v{record.engine_data_version + 1} 的迁移路径。"
                "该版本跨度不受本次发布支持：请先升级到中间版本，或显式选择重建索引。"
            )
        migrator(engine_dir)
        record = EngineDataRecord(
            engine_data_version=record.engine_data_version + 1,
            zleap_sag_version=installed,
            created_by_app=app_version,
            updated_at=datetime.now(UTC).isoformat(),
        )
        write_record(engine_dir, record)

    if installed != "unknown" and installed not in SUPPORTED_ZLEAP_SAG_VERSIONS:
        message = (
            f"当前安装的 zleap-sag {installed} 不在本次发布支持集 "
            f"{sorted(SUPPORTED_ZLEAP_SAG_VERSIONS)} 内。"
        )
        if settings.runtime_mode == "desktop":
            # 桌面发布严格执行版本钉住（缺路径即阻断，ADR-0015）。
            raise EngineDataIncompatible(message + " 请使用与数据匹配的应用版本。")
        log.warning("%s（standard 模式仅告警）", message)

    if record.zleap_sag_version != installed and installed != "unknown":
        record = EngineDataRecord(
            engine_data_version=record.engine_data_version,
            zleap_sag_version=installed,
            created_by_app=app_version,
            updated_at=datetime.now(UTC).isoformat(),
        )
        write_record(engine_dir, record)
    return record
