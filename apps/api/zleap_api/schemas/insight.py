from __future__ import annotations

from pydantic import BaseModel


class EntityOut(BaseModel):
    id: str
    name: str
    type: str
    description: str
    heat: int
