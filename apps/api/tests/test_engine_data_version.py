"""引擎数据版本门禁（ADR-0015）。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sag_api.sag.engine_data_version import (
    CURRENT_ENGINE_DATA_VERSION,
    RECORD_FILENAME,
    EngineDataIncompatible,
    read_record,
    verify_and_upgrade_engine_data,
    write_record,
)


def test_first_install_writes_current_record(tmp_path: Path):
    record = verify_and_upgrade_engine_data(tmp_path)
    assert record.engine_data_version == CURRENT_ENGINE_DATA_VERSION
    persisted = read_record(tmp_path)
    assert persisted is not None
    assert persisted.engine_data_version == CURRENT_ENGINE_DATA_VERSION


def test_pre_versioning_data_is_adopted_in_place(tmp_path: Path):
    # 有引擎数据但无版本记录 = v0 存量
    (tmp_path / "lancedb").mkdir()
    (tmp_path / "sag.db").write_bytes(b"")
    record = verify_and_upgrade_engine_data(tmp_path)
    assert record.engine_data_version == CURRENT_ENGINE_DATA_VERSION
    assert (tmp_path / RECORD_FILENAME).exists()
    # 数据原样保留
    assert (tmp_path / "lancedb").is_dir()


def test_newer_data_version_blocks_startup(tmp_path: Path):
    (tmp_path / RECORD_FILENAME).write_text(
        json.dumps(
            {
                "engine_data_version": CURRENT_ENGINE_DATA_VERSION + 1,
                "zleap_sag_version": "9.9.9",
                "created_by_app": "future",
                "updated_at": "",
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(EngineDataIncompatible) as excinfo:
        verify_and_upgrade_engine_data(tmp_path)
    assert excinfo.value.code == "engine-data-incompatible"
    assert "升级应用" in str(excinfo.value)


def test_corrupt_record_blocks_startup(tmp_path: Path):
    (tmp_path / RECORD_FILENAME).write_text('{"engine_data_version": "not-a-number"}')
    with pytest.raises(EngineDataIncompatible):
        verify_and_upgrade_engine_data(tmp_path)


def test_record_round_trip(tmp_path: Path):
    first = verify_and_upgrade_engine_data(tmp_path)
    write_record(tmp_path, first)
    again = verify_and_upgrade_engine_data(tmp_path)
    assert again.engine_data_version == first.engine_data_version
