"""ORM 模型聚合导入 —— 保证 Base.metadata 注册全部表。"""

from muse_api.db.models.chat import ChatMessage, ChatThread
from muse_api.db.models.document import Document
from muse_api.db.models.job import Job
from muse_api.db.models.namespace import Namespace
from muse_api.db.models.setting import Setting
from muse_api.db.models.soul import Soul, SoulBinding, SoulMessage, SoulThread
from muse_api.db.models.source import Source
from muse_api.db.models.user import User
from muse_api.db.models.workspace import Membership, Workspace

__all__ = [
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
