"""跨层共享的枚举（模型 / schema / 服务均可导入，无副作用）。"""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    def __str__(self) -> str:  # 便于日志 / 序列化
        return self.value


class UserRole(StrEnum):
    ADMIN = "admin"
    MEMBER = "member"


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class ConnectorKind(StrEnum):
    FILE_UPLOAD = "file_upload"
    WEB = "web"
    # 预留：NOTION = "notion"; S3 = "s3"; CONFLUENCE = "confluence"; ...


class SourceStatus(StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    ERROR = "error"


class DocumentStatus(StrEnum):
    PENDING = "pending"        # 已登记，待处理
    LOADING = "loading"        # ingest 中（解析 → 分块 → 入库 → 向量）
    EXTRACTING = "extracting"  # extract 中（事件 / 实体抽取）
    READY = "ready"            # 处理完成，可检索
    FAILED = "failed"


class JobType(StrEnum):
    PROCESS_DOCUMENT = "process_document"
    SYNC_SOURCE = "sync_source"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
