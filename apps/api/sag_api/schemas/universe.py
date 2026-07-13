from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

UniverseNodeKind = Literal["event", "entity"]
UniverseNodeState = Literal["latent", "active"]


class UniverseTimeBucketOut(BaseModel):
    start: datetime
    end: datetime
    count: int = 0


class UniversePartitionOut(BaseModel):
    id: str
    source_id: str
    parent_id: str | None = None
    kind: Literal["source", "topic"]
    key: str
    label: str
    x: float
    y: float
    z: float = 0.0
    radius: float
    node_count: int
    event_count: int = 0
    entity_count: int = 0
    relation_count: int = 0
    density: float = 0.0
    time_buckets: list[UniverseTimeBucketOut] = Field(default_factory=list)
    importance: float


class UniversePolicyOut(BaseModel):
    source_limit: int
    entity_page_size: int
    entity_page_max: int
    timeline_event_page_size: int
    event_entity_limit: int
    auto_page_limit: int
    lod_orbit_px: int
    lod_near_px: int
    lod_deep_px: int
    lod_hysteresis_px: int
    lod_debounce_ms: int
    proxy_budget_desktop: int
    proxy_budget_mobile: int
    node_budget_desktop: int
    node_budget_mobile: int
    edge_budget_desktop: int
    edge_budget_mobile: int


class UniverseManifestOut(BaseModel):
    version: str | None = None
    status: Literal["empty", "building", "ready", "stale", "failed"]
    stale: bool = False
    as_of: datetime | None = None
    bounds: dict[str, float] = Field(default_factory=dict)
    partitions: list[UniversePartitionOut] = Field(default_factory=list)
    counts: dict[str, int] = Field(default_factory=dict)
    policy: UniversePolicyOut


class UniverseRelationOut(BaseModel):
    source_id: str
    from_id: str
    to_id: str
    kind: Literal["mentions", "subevent"] = "mentions"
    weight: float = 1.0
    description: str = ""


class UniverseEvidenceOut(BaseModel):
    source_id: str
    source_name: str
    document_id: str | None = None
    document_name: str | None = None
    chunk_id: str | None = None
    heading: str = ""
    content: str = ""


class UniverseNodeDetailOut(BaseModel):
    id: str
    kind: UniverseNodeKind
    source_id: str
    source_name: str
    label: str
    description: str = ""
    category: str = ""
    start_time: datetime | None = None
    evidence: UniverseEvidenceOut | None = None


class UniverseExpandIn(BaseModel):
    epoch: int = Field(ge=1)
    source_id: str = Field(min_length=1, max_length=64)
    node_kind: UniverseNodeKind
    node_id: str = Field(min_length=1, max_length=128)
    limit: int = Field(default=20, ge=1, le=128)
    cursor: str | None = Field(default=None, max_length=2048)
    after: datetime | None = None
    before: datetime | None = None

    @model_validator(mode="after")
    def validate_time_window(self) -> UniverseExpandIn:
        if self.node_kind == "event" and (self.after is not None or self.before is not None):
            raise ValueError("事件到实体的扩展不接受时间范围")
        if self.after is not None and self.before is not None:
            after = self.after.replace(tzinfo=UTC) if self.after.tzinfo is None else self.after
            before = self.before.replace(tzinfo=UTC) if self.before.tzinfo is None else self.before
            if after.astimezone(UTC) > before.astimezone(UTC):
                raise ValueError("after 不能晚于 before")
        return self


class UniverseActivateIn(BaseModel):
    epoch: int = Field(ge=1)
    source_id: str = Field(min_length=1, max_length=64)
    category: str | None = Field(default=None, max_length=160)
    limit: int = Field(default=24, ge=1, le=48)
    cursor: str | None = Field(default=None, max_length=2048)
    after: datetime | None = None
    before: datetime | None = None

    @model_validator(mode="after")
    def validate_time_window(self) -> UniverseActivateIn:
        if self.after is not None and self.before is not None:
            after = self.after.replace(tzinfo=UTC) if self.after.tzinfo is None else self.after
            before = self.before.replace(tzinfo=UTC) if self.before.tzinfo is None else self.before
            if after.astimezone(UTC) > before.astimezone(UTC):
                raise ValueError("after 不能晚于 before")
        if self.category is not None:
            self.category = self.category.strip() or None
        return self


class UniverseTimelineIn(BaseModel):
    epoch: int = Field(ge=1)
    source_id: str = Field(min_length=1, max_length=64)
    limit: int = Field(default=8, ge=1, le=24)
    cursor: str | None = Field(default=None, max_length=2048)


class UniversePatchNodeOut(BaseModel):
    id: str
    kind: UniverseNodeKind
    source_id: str
    label: str = ""
    description: str = ""
    category: str = ""
    chunk_id: str | None = None
    start_time: datetime | None = None
    importance: float = 0.5
    related_count: int = 0
    state: UniverseNodeState = "active"


class UniversePageOut(BaseModel):
    returned: int = 0
    has_more: bool = False
    next_cursor: str | None = None


class UniverseActivationSeedOut(BaseModel):
    epoch: int
    source_id: str
    category: str | None = None
    seed_kind: Literal["entity"] = "entity"
    nodes: list[UniversePatchNodeOut] = Field(default_factory=list)
    has_more: bool = False
    page: UniversePageOut
    as_of: datetime


class UniverseTimelineSliceOut(BaseModel):
    epoch: int
    source_id: str
    nodes: list[UniversePatchNodeOut] = Field(default_factory=list)
    relations: list[UniverseRelationOut] = Field(default_factory=list)
    page: UniversePageOut
    as_of: datetime


class UniverseGraphPatchOut(BaseModel):
    epoch: int
    anchor: UniversePatchNodeOut
    nodes: list[UniversePatchNodeOut] = Field(default_factory=list)
    relations: list[UniverseRelationOut] = Field(default_factory=list)
    page: UniversePageOut
    as_of: datetime | None = None


class ExplorationSessionOut(BaseModel):
    id: str
    title: str
    source_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    step_count: int = 0


class ExplorationStepOut(BaseModel):
    id: str
    session_id: str
    query: str
    summary: str
    source_ids: list[str] = Field(default_factory=list)
    event_refs: list[dict] = Field(default_factory=list)
    entity_refs: list[dict] = Field(default_factory=list)
    relation_refs: list[dict] = Field(default_factory=list)
    evidence_refs: list[dict] = Field(default_factory=list)
    camera: dict = Field(default_factory=dict)
    created_at: datetime


class ExplorationDetailOut(BaseModel):
    session: ExplorationSessionOut
    steps: list[ExplorationStepOut] = Field(default_factory=list)
