"""路径与配置加固（ADR-0012）：单根派生、绝对化、desktop 默认、env 卫生。"""

from __future__ import annotations

from pathlib import Path

import pytest

from sag_api.core.config import Settings
from sag_api.core.paths import data_paths, ensure_data_layout

# conftest 为全局单例注入的存储/调试环境变量会盖过本套件的构造参数，先摘掉。
_CONFTEST_ENV_KEYS = ("SAG_DATABASE_URL", "SAG_DATA_DIR", "SAG_UPLOAD_DIR", "SAG_DEBUG")


@pytest.fixture(autouse=True)
def _clean_storage_env(monkeypatch: pytest.MonkeyPatch):
    for key in _CONFTEST_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _settings(**kwargs) -> Settings:
    """绕过 .env 构造独立 Settings 实例（进程 env 已由夹具清理）。"""
    return Settings(_env_file=None, **kwargs)


class TestDataRootDerivation:
    def test_derives_all_three_paths_from_single_root(self, tmp_path: Path):
        s = _settings(data_root=str(tmp_path / "AppData"))
        root = (tmp_path / "AppData").resolve()
        assert s.data_root == str(root)
        assert s.database_url == f"sqlite+aiosqlite:///{root / 'sag.db'}"
        assert s.data_dir == str(root / "engine")
        assert s.upload_dir == str(root / "uploads")

    def test_explicit_fields_win_over_root_derivation(self, tmp_path: Path):
        explicit = tmp_path / "elsewhere" / "uploads"
        s = _settings(data_root=str(tmp_path / "root"), upload_dir=str(explicit))
        assert s.upload_dir == str(explicit.resolve())
        # 未显式的仍从根派生
        assert s.data_dir == str((tmp_path / "root" / "engine").resolve())

    def test_relative_defaults_are_absolutized_against_cwd(self, tmp_path: Path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        s = _settings()
        assert Path(s.data_dir).is_absolute()
        assert Path(s.upload_dir).is_absolute()
        assert s.data_dir == str((tmp_path / ".data" / "engine").resolve())
        assert s.database_url == f"sqlite+aiosqlite:///{(tmp_path / '.data' / 'sag.db').resolve()}"

    def test_memory_database_url_untouched(self):
        s = _settings(database_url="sqlite+aiosqlite:///:memory:")
        assert s.database_url == "sqlite+aiosqlite:///:memory:"
        assert s.sqlite_db_path is None

    def test_non_sqlite_url_untouched(self):
        url = "postgresql+asyncpg://sag:sag@db:5432/sag"
        s = _settings(database_url=url)
        assert s.database_url == url
        assert s.sqlite_db_path is None


class TestDesktopModeDefaults:
    def test_desktop_tightens_registration_and_debug(self, tmp_path: Path):
        s = _settings(runtime_mode="desktop", data_root=str(tmp_path))
        assert s.allow_registration is False
        assert s.debug is False

    def test_desktop_respects_explicit_overrides(self, tmp_path: Path):
        s = _settings(
            runtime_mode="desktop",
            data_root=str(tmp_path),
            allow_registration=True,
            debug=True,
        )
        assert s.allow_registration is True
        assert s.debug is True

    def test_standard_mode_keeps_dev_defaults(self):
        s = _settings()
        assert s.runtime_mode == "standard"
        assert s.allow_registration is True
        assert s.debug is True


class TestDataPathsLayout:
    def test_layout_from_root(self, tmp_path: Path):
        s = _settings(data_root=str(tmp_path / "AppData"))
        paths = ensure_data_layout(s)
        root = (tmp_path / "AppData").resolve()
        assert paths.root == root
        assert paths.db_path == root / "sag.db"
        assert paths.engine_dir == root / "engine"
        assert paths.upload_dir == root / "uploads"
        assert paths.backup_dir == root / "backups"
        assert paths.lock_path == root / ".sag.lock"
        assert paths.secret_key_path == root / "secret.key"
        # ensure 创建目录（backup 目录按需创建，不在此列）
        assert paths.engine_dir.is_dir()
        assert paths.upload_dir.is_dir()

    def test_dev_fallback_root_is_db_parent(self, tmp_path: Path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        s = _settings()
        paths = data_paths(s)
        assert paths.root == (tmp_path / ".data").resolve()


class TestZleapEnvHygiene:
    def test_disable_zleap_dotenv_flips_model_config(self):
        from zleap.sag.core.config import settings as zleap_settings

        import sag_api.sag.env_hygiene as hygiene

        original = zleap_settings.Settings.model_config.get("env_file")
        original_applied = hygiene._applied
        try:
            hygiene._applied = False
            hygiene.disable_zleap_dotenv()
            assert zleap_settings.Settings.model_config.get("env_file") is None
            # 幂等
            hygiene.disable_zleap_dotenv()
            assert zleap_settings.Settings.model_config.get("env_file") is None
        finally:
            zleap_settings.Settings.model_config["env_file"] = original
            zleap_settings.get_settings.cache_clear()
            hygiene._applied = original_applied


class TestDotenvKillSwitch:
    def test_kill_switch_semantics(self):
        # 模块级 _ENV_FILE 在导入时按该谓词求值;直接测谓词,避免 reload 污染单例。
        from sag_api.core.config import dotenv_disabled

        assert dotenv_disabled("1") is True
        assert dotenv_disabled("true") is True
        assert dotenv_disabled(" YES ") is True
        assert dotenv_disabled("0") is False
        assert dotenv_disabled("") is False
        assert dotenv_disabled(None) is False
