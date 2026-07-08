"""命名空间领域逻辑。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from zleap_api.core.errors import ConflictError, NotFoundError, ValidationError
from zleap_api.db.models import Namespace
from zleap_api.enums import NamespaceKind

# 默认命名空间定义
_DEFAULTS = [
    {"name": "会话记忆", "kind": NamespaceKind.MEMORY, "icon": "brain", "color": "gold"},
    {"name": "知识", "kind": NamespaceKind.KNOWLEDGE, "icon": "book", "color": "ink"},
]


async def list_namespaces(session: AsyncSession, workspace_id: str) -> list[Namespace]:
    rows = await session.execute(
        select(Namespace).where(Namespace.workspace_id == workspace_id).order_by(
            Namespace.is_system.desc(), Namespace.created_at
        )
    )
    return list(rows.scalars().all())


async def get_namespace(session: AsyncSession, workspace_id: str, namespace_id: str) -> Namespace:
    ns = await session.get(Namespace, namespace_id)
    if ns is None or ns.workspace_id != workspace_id:
        raise NotFoundError("分组不存在")
    return ns


async def create_namespace(
    session: AsyncSession,
    workspace_id: str,
    *,
    name: str,
    kind: NamespaceKind = NamespaceKind.CUSTOM,
    icon: str = "",
    color: str = "",
    is_system: bool = False,
) -> Namespace:
    name = name.strip()
    if not name:
        raise ValidationError("分组名称不能为空")
    exists = await session.scalar(
        select(Namespace).where(Namespace.workspace_id == workspace_id, Namespace.name == name)
    )
    if exists is not None:
        raise ConflictError("同名分组已存在")
    ns = Namespace(
        workspace_id=workspace_id, name=name, kind=kind, icon=icon, color=color, is_system=is_system
    )
    session.add(ns)
    await session.commit()
    await session.refresh(ns)
    return ns


async def delete_namespace(session: AsyncSession, workspace_id: str, namespace_id: str) -> None:
    ns = await get_namespace(session, workspace_id, namespace_id)
    if ns.is_system:
        raise ValidationError("默认分组不可删除")
    await session.delete(ns)
    await session.commit()


async def ensure_default_namespaces(
    session: AsyncSession, workspace_id: str
) -> dict[NamespaceKind, Namespace]:
    """幂等地保证默认命名空间存在，返回 {kind: namespace}。"""
    existing = {ns.kind: ns for ns in await list_namespaces(session, workspace_id)}
    changed = False
    for d in _DEFAULTS:
        if d["kind"] not in existing:
            ns = Namespace(
                workspace_id=workspace_id,
                name=d["name"],
                kind=d["kind"],
                icon=d["icon"],
                color=d["color"],
                is_system=True,
            )
            session.add(ns)
            existing[d["kind"]] = ns
            changed = True
    if changed:
        await session.commit()
    return existing


async def default_namespace(
    session: AsyncSession, workspace_id: str, kind: NamespaceKind
) -> Namespace:
    defaults = await ensure_default_namespaces(session, workspace_id)
    return defaults[kind]
