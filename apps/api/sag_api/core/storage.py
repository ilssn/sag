"""受管文件存储（ADR-0013）。

数据库只存相对 storage_key；一切磁盘访问经本层解析并校验解析结果
仍落在存储根内（含符号链接逃逸）。存储根 = settings.upload_dir
（desktop 模式即 {data_root}/uploads），数据目录因此可整体迁移/备份/跨机恢复。
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath

from sag_api.core.config import settings
from sag_api.core.errors import ValidationError
from sag_api.core.logging import get_logger

log = get_logger("storage")


class StorageKeyError(ValidationError):
    """非法 storage_key（空/绝对/包含 ..、反斜杠、NUL 或逃逸存储根）。"""


def _validate_part(part: str) -> str:
    if not part or part in {".", ".."}:
        raise StorageKeyError("storage_key 片段不能为空或相对指示符")
    if "\\" in part or "\x00" in part or "/" in part:
        raise StorageKeyError("storage_key 片段包含非法字符")
    return part


class ManagedStorage:
    def __init__(self, root: Path):
        self._root = root.resolve()

    @property
    def root(self) -> Path:
        return self._root

    def key_for(self, *parts: str) -> str:
        """由片段组装 posix 风格 key（逐片段校验）。"""
        if not parts:
            raise StorageKeyError("storage_key 不能为空")
        return str(PurePosixPath(*[_validate_part(part) for part in parts]))

    def resolve(self, key: str) -> Path:
        """key → 绝对路径；校验含符号链接解析后的落点仍在存储根内。"""
        if not key or not isinstance(key, str):
            raise StorageKeyError("storage_key 不能为空")
        if "\x00" in key or "\\" in key:
            raise StorageKeyError("storage_key 包含非法字符")
        pure = PurePosixPath(key)
        if pure.is_absolute() or any(part in {"..", "."} for part in pure.parts):
            raise StorageKeyError("storage_key 必须是根内相对路径")
        if str(pure) != key:
            # 拒绝非规范形（"./a"、"a//b"、尾斜杠等），键必须唯一可比对。
            raise StorageKeyError("storage_key 必须是规范化的相对路径")
        candidate = self._root / Path(*pure.parts)
        resolved = candidate.resolve()
        if not resolved.is_relative_to(self._root):
            raise StorageKeyError("storage_key 解析结果逃逸存储根")
        return resolved

    def resolve_existing(self, key: str | None) -> Path | None:
        """宽容读取：key 非法或文件不存在返回 None（调用方按业务 404 处理）。"""
        if not key:
            return None
        try:
            path = self.resolve(key)
        except StorageKeyError:
            log.warning("拒绝非法 storage_key：%r", key)
            return None
        return path if path.is_file() else None

    def save(self, key: str, data: bytes) -> Path:
        path = self.resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def read_bytes(self, key: str) -> bytes:
        return self.resolve(key).read_bytes()

    def delete(self, key: str, *, missing_ok: bool = True) -> None:
        path = self.resolve(key)
        try:
            path.unlink(missing_ok=missing_ok)
        except OSError as error:
            log.warning("删除存储文件失败 %s：%s", path, error)

    def delete_prefix(self, prefix: str) -> None:
        """删除某前缀（如信源 id）下的整棵子树。"""
        import shutil

        path = self.resolve(prefix)
        shutil.rmtree(path, ignore_errors=True)


def get_storage() -> ManagedStorage:
    """按当前配置绑定存储根（settings 单例可被运行时覆盖，故不缓存实例）。"""
    return ManagedStorage(Path(settings.upload_dir))
