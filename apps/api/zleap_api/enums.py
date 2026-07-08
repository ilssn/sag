"""跨层共享的枚举（模型 / schema / 服务均可导入，无副作用）。"""

from __future__ import annotations

from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    MEMBER = "member"


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class NamespaceKind(StrEnum):
    MEMORY = "memory"        # 会话记忆
    KNOWLEDGE = "knowledge"  # 知识
    CUSTOM = "custom"


class SourceType(StrEnum):
    DOCUMENT = "document"
    WEB = "web"
    MESSAGE = "message"
    CONVERSATION = "conversation"
    AUDIO = "audio"


class ConnectorKind(StrEnum):
    FILE_UPLOAD = "file_upload"
    WEB = "web"
    # 预留：NOTION = "notion"; S3 = "s3"; CONFLUENCE = "confluence"; ...


# 连接器 → 默认信源类型
CONNECTOR_SOURCE_TYPE = {
    ConnectorKind.FILE_UPLOAD: SourceType.DOCUMENT,
    ConnectorKind.WEB: SourceType.WEB,
}


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


class SoulVisibility(StrEnum):
    PRIVATE = "private"      # 仅创建者可见
    WORKSPACE = "workspace"  # 空间内成员可见（共享助手）


class SoulOrigin(StrEnum):
    USER = "user"
    BOOK_ENTITY = "book_entity"
    MOUNT = "mount"
    IMPORT = "import"


class SoulStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class BindingTargetType(StrEnum):
    NAMESPACE = "namespace"
    SOURCE = "source"
