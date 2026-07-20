import { describe, expect, it } from "vitest";

import {
  planUniversePreviewCards,
  universeCardApertureBucket,
  type UniversePreviewNode,
} from "./universe-preview-plan";

const nodes: UniversePreviewNode[] = [
  { id: "event-a", kind: "event", sourceId: "source-a", active: true },
  { id: "event-b", kind: "event", sourceId: "source-a", active: true },
  { id: "event-c", kind: "event", sourceId: "source-a", active: true },
  { id: "entity-a", kind: "entity", sourceId: "source-a", active: true },
  { id: "entity-b", kind: "entity", sourceId: "source-a", active: true },
];

const adjacency = new Map<string, ReadonlySet<string>>([
  ["event-a", new Set(["entity-a"])],
  ["event-b", new Set(["entity-b"])],
  ["event-c", new Set()],
  ["entity-a", new Set(["event-a"])],
  ["entity-b", new Set(["event-b"])],
]);

function plan(
  overrides: Partial<Parameters<typeof planUniversePreviewCards>[0]> = {},
) {
  return planUniversePreviewCards({
    nodes,
    adjacency,
    sourceId: "source-a",
    focusId: null,
    cardsEnabled: true,
    eventPreviewCount: 2,
    entitySafetyMax: 24,
    ...overrides,
  });
}

describe("universe event card display limit", () => {
  it("limits event cards independently while preserving their related entities", () => {
    expect(plan()).toMatchObject({
      eventIds: ["event-a", "event-b"],
      entityIds: ["entity-a", "entity-b"],
    });
  });

  it("brings every resident entity out with its event card at rest", () => {
    const relatedEntities = Array.from({ length: 8 }, (_, index) => ({
      id: `entity-${index}`,
      kind: "entity" as const,
      sourceId: "source-a",
      active: true,
    }));
    const entityIds = relatedEntities.map((node) => node.id);

    expect(plan({
      nodes: [
        { id: "event-a", kind: "event", sourceId: "source-a", active: true },
        ...relatedEntities,
      ],
      adjacency: new Map([
        ["event-a", new Set(entityIds)],
      ]),
      eventPreviewCount: 1,
    })).toMatchObject({
      eventIds: ["event-a"],
      entityIds,
      hiddenRelatedEntityCount: 0,
    });
  });

  it("lets a focused one-hop network replace the resting card selection", () => {
    expect(plan({
      focusId: "event-c",
      eventPreviewCount: 1,
    })).toMatchObject({
      eventIds: ["event-c"],
      entityIds: [],
      focused: true,
    });
  });

  it("keeps the star network card-free at rest when cards are disabled", () => {
    expect(plan({ cardsEnabled: false }).ids).toEqual([]);
  });

  it("follows the current timeline position instead of pinning the first cards", () => {
    expect(plan({
      nodes: nodes.map((node, index) => ({
        ...node,
        viewDistance: node.kind === "event" ? Math.abs(index - 2) : undefined,
      })),
      eventPreviewCount: 1,
    }).eventIds).toEqual(["event-c"]);
  });

  it("refreshes the bounded aperture every three travelled events", () => {
    expect(universeCardApertureBucket(0, 60)).toBe(0);
    expect(universeCardApertureBucket(179, 60)).toBe(0);
    expect(universeCardApertureBucket(180, 60)).toBe(1);
  });
});
