from fastapi import APIRouter

from muse_api.api.v1 import (
    auth,
    chat,
    documents,
    jobs,
    namespaces,
    search,
    souls,
    sources,
    system,
)

api_router = APIRouter(prefix="/api/v1")
for _module in (auth, namespaces, sources, documents, jobs, search, souls, chat, system):
    api_router.include_router(_module.router)

__all__ = ["api_router"]
