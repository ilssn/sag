"""数据目录布局（ADR-0012）。

所有磁盘落点集中在此推导与创建；启动时打印一份解析结果，
让「数据到底写在哪」永远可以从日志直接回答。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sag_api.core.config import Settings
from sag_api.core.logging import get_logger

log = get_logger("paths")


@dataclass(frozen=True)
class DataPaths:
    """一次启动内的全部磁盘落点（均为绝对路径）。"""

    root: Path
    """数据根：data_root 或（dev 回退）各路径的共同父目录。"""
    db_path: Path | None
    """SQLite 元数据库文件；非 SQLite 后端为 None。"""
    engine_dir: Path
    """zleap-sag 引擎数据（LanceDB + 引擎 SQLite）。"""
    upload_dir: Path
    """上传原始文件与解析产物。"""
    backup_dir: Path
    """迁移前 SQLite 恢复点（ADR-0014）。"""
    lock_path: Path
    """单实例数据锁（ADR-0016）。"""
    secret_key_path: Path
    """desktop 模式首启生成的持久签名密钥。"""


def data_paths(settings: Settings) -> DataPaths:
    engine_dir = Path(settings.data_dir)
    upload_dir = Path(settings.upload_dir)
    db_path = settings.sqlite_db_path
    if settings.data_root:
        root = Path(settings.data_root)
    elif db_path is not None:
        # dev 回退：默认布局下三者同居 ./.data —— 取元数据库所在目录为根。
        root = db_path.parent
    else:
        root = engine_dir.parent
    return DataPaths(
        root=root,
        db_path=db_path,
        engine_dir=engine_dir,
        upload_dir=upload_dir,
        backup_dir=root / "backups",
        lock_path=root / ".sag.lock",
        secret_key_path=root / "secret.key",
    )


def ensure_data_layout(settings: Settings) -> DataPaths:
    """创建全部数据目录（幂等）。替代散落各处的 os.makedirs。"""
    paths = data_paths(settings)
    paths.root.mkdir(parents=True, exist_ok=True)
    paths.engine_dir.mkdir(parents=True, exist_ok=True)
    paths.upload_dir.mkdir(parents=True, exist_ok=True)
    if paths.db_path is not None:
        paths.db_path.parent.mkdir(parents=True, exist_ok=True)
    return paths


def _foreign_dotenv_on_zleap_walkup() -> Path | None:
    """复算 zleap `_find_project_root()` 的 .env 向上查找，返回将被其装载的文件。"""
    try:
        from zleap.sag.core.config import settings as zleap_settings

        current = Path(zleap_settings.__file__).resolve()
    except Exception:  # noqa: BLE001 —— 依赖不可用时不做诊断
        return None
    for parent in [current.parent, *current.parents]:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    return None


def log_runtime_summary(settings: Settings, paths: DataPaths) -> None:
    """启动自检：一眼看清运行模式与所有落盘位置。"""
    log.info(
        "运行时布局 · mode=%s env=%s · root=%s · db=%s · engine=%s · uploads=%s · dotenv=%s",
        settings.runtime_mode,
        settings.environment,
        paths.root,
        paths.db_path or settings.database_url,
        paths.engine_dir,
        paths.upload_dir,
        "off" if Settings.model_config.get("env_file") is None else "on",
    )
    foreign = _foreign_dotenv_on_zleap_walkup()
    if foreign is not None:
        log.warning(
            "检测到 zleap 依赖包 .env 向上查找命中：%s —— "
            "该文件可能向引擎注入意外配置；sidecar/受控环境应保持 env 卫生（已由 env_hygiene 禁用装载）。",
            foreign,
        )
