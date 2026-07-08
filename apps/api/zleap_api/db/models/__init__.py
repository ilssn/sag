"""ORM 模型聚合导入 —— 保证 Base.metadata 注册全部表。"""

from zleap_api.db.models.audit import AuditLog
from zleap_api.db.models.chat import ChatMessage, ChatThread
from zleap_api.db.models.document import Document
from zleap_api.db.models.job import Job
from zleap_api.db.models.namespace import Namespace
from zleap_api.db.models.setting import Setting
from zleap_api.db.models.soul import Soul, SoulBinding, SoulMessage, SoulThread
from zleap_api.db.models.source import Source
from zleap_api.db.models.user import User
from zleap_api.db.models.workspace import Membership, Workspace

__all__ = [
    "AuditLog",
    "ChatMessage",
    "ChatThread",
    "Document",
    "Job",
    "Membership",
    "Namespace",
    "Setting",
    "Soul",
    "SoulBinding",
    "SoulMessage",
    "SoulThread",
    "Source",
    "User",
    "Workspace",
]
