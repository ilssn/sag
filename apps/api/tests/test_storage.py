"""受管存储层（ADR-0013）：键校验、遏制、增删读与 0002 回填策略。"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from sag_api.core.storage import ManagedStorage, StorageKeyError


@pytest.fixture
def storage(tmp_path: Path) -> ManagedStorage:
    root = tmp_path / "uploads"
    root.mkdir()
    return ManagedStorage(root)


class TestKeyValidation:
    def test_key_for_builds_posix_keys(self, storage: ManagedStorage):
        assert storage.key_for("src-1", "doc_a.md") == "src-1/doc_a.md"

    @pytest.mark.parametrize("parts", [(), ("",), ("..",), ("a/b",), ("a\\b",), ("a\x00b",)])
    def test_key_for_rejects_illegal_parts(self, storage: ManagedStorage, parts):
        with pytest.raises(StorageKeyError):
            storage.key_for(*parts)

    @pytest.mark.parametrize(
        "key",
        ["", "/etc/passwd", "../escape.md", "a/../../escape.md", "a\\b.md", "a\x00b", "./a.md"],
    )
    def test_resolve_rejects_traversal_and_absolute(self, storage: ManagedStorage, key):
        with pytest.raises(StorageKeyError):
            storage.resolve(key)

    def test_resolve_rejects_symlink_escape(self, storage: ManagedStorage, tmp_path: Path):
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "secret.txt").write_text("s")
        os.symlink(outside, storage.root / "link")
        with pytest.raises(StorageKeyError):
            storage.resolve("link/secret.txt")

    def test_resolve_existing_is_lenient(self, storage: ManagedStorage):
        assert storage.resolve_existing(None) is None
        assert storage.resolve_existing("") is None
        assert storage.resolve_existing("../escape") is None  # 非法键不抛，仅 None
        assert storage.resolve_existing("missing/file.md") is None


class TestReadWriteDelete:
    def test_save_read_delete_round_trip(self, storage: ManagedStorage):
        key = storage.key_for("src-1", "a.md")
        path = storage.save(key, b"hello")
        assert path.is_file()
        assert storage.read_bytes(key) == b"hello"
        assert storage.resolve_existing(key) == path
        storage.delete(key)
        assert storage.resolve_existing(key) is None

    def test_delete_prefix_removes_subtree(self, storage: ManagedStorage):
        storage.save(storage.key_for("src-1", "a.md"), b"1")
        storage.save(storage.key_for("src-1", "b.md"), b"2")
        storage.save(storage.key_for("src-2", "c.md"), b"3")
        storage.delete_prefix("src-1")
        assert storage.resolve_existing("src-1/a.md") is None
        assert storage.resolve_existing("src-2/c.md") is not None


class TestBackfillPolicy:
    """0002 迁移的 _to_key 策略：根内相对化 / basename 恢复 / 孤儿。"""

    def test_policies(self, tmp_path: Path):
        import importlib

        # 版本文件名以数字开头，须经 importlib 按字符串导入
        module = importlib.import_module(
            "sag_api.db.migrations.versions.0002_document_storage_key"
        )
        to_key = module._to_key
        root = tmp_path / "uploads"
        (root / "s1").mkdir(parents=True)
        managed = root / "s1" / "d1_a.md"
        managed.write_text("x")

        # ① 根内绝对路径 → 相对键
        assert to_key(str(managed), root, "s1", "d1") == "s1/d1_a.md"
        # ② 根外路径但 root/{source}/{basename} 存在 → 恢复
        assert to_key("/elsewhere/tree/d1_a.md", root, "s1", "d1") == "s1/d1_a.md"
        # ③ 彻底孤儿 → _orphaned 键（永不解析成功，走 404 文案；原文件不动）
        assert to_key("/tmp/gone.md", root, "s1", "d9") == "_orphaned/d9/gone.md"
        # ④ 空路径
        assert to_key(None, root, "s1", "d9") == "_orphaned/d9/unknown"
