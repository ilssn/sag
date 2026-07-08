from fastapi import APIRouter

from zleap_api.api.v1 import (
    agents,
    auth,
    documents,
    insights,
    jobs,
    openai,
    search,
    sources,
    system,
)

api_router = APIRouter(prefix="/api/v1")
for _module in (auth, sources, documents, insights, jobs, search, agents, openai, system):
    api_router.include_router(_module.router)
api_router.include_router(search.global_router)

__all__ = ["api_router"]
