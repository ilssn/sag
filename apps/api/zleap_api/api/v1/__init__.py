from fastapi import APIRouter

from zleap_api.api.v1 import (
    auth,
    documents,
    insights,
    jobs,
    namespaces,
    search,
    souls,
    sources,
    system,
)

api_router = APIRouter(prefix="/api/v1")
for _module in (auth, namespaces, sources, documents, insights, jobs, search, souls, system):
    api_router.include_router(_module.router)
api_router.include_router(search.global_router)

__all__ = ["api_router"]
