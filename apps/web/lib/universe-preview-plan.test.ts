import { describe, expect, it } from "vitest";

import {
  planUniversePreviewCards,
  type UniversePreviewNode,
} from "./universe-preview-plan";

const nodes: UniversePreviewNode[] = [
  { id: "event-a", kind: "event", sourceId: "source-a", active: true },
  { id: "event-b", kind: "event", sourceId: "source-a", active: true },
  { id: "event-c", kind: "event", sourceId: "source-a", active: true },
  { id: "entity-shared", kind: "entity", sourceId: "source-a", active: true },
  { id: "entity-a", kind: "entity", sourceId: "source-a", active: true },
  { id: "entity-b", kind: "entity", sourceId: "source-a", active: true },
  { id: "event-other", kind: "event", sourceId: "source-b", active: true },
];

const adjacency = new Map<string, ReadonlySet<string>>([
  ["event-a", new Set(["entity-shared", "entity-a"])],
  ["event-b", new Set(["entity-shared", "entity-b"])],
  ["event-c", new Set()],
  ["entity-shared", new Set(["event-a", "event-b"])],
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

describe("universe preview aperture", () => {
  it("selects events first and only brings their directly related entities", () => {
    expect(plan()).toEqual({
      ids: [
        "event-a",
        "event-b",
        "entity-shared",
        "entity-a",
        "entity-b",
      ],
      eventIds: ["event-a", "event-b"],
      entityIds: ["entity-shared", "entity-a", "entity-b"],
      focused: false,
      hiddenRelatedEntityCount: 0,
    });
  });

  it("lets focus take over the existing aperture without adding resting cards", () => {
    expect(plan({ focusId: "entity-shared", eventPreviewCount: 1 })).toEqual({
      ids: ["event-a", "entity-shared"],
      eventIds: ["event-a"],
      entityIds: ["entity-shared"],
      focused: true,
      hiddenRelatedEntityCount: 0,
    });
  });

  it("reveals a focused event even when resting cards are disabled", () => {
    expect(plan({
      focusId: "event-a",
      cardsEnabled: false,
      eventPreviewCount: 0,
    })).toEqual({
      ids: ["event-a", "entity-shared", "entity-a"],
      eventIds: ["event-a"],
      entityIds: ["entity-shared", "entity-a"],
      focused: true,
      hiddenRelatedEntityCount: 0,
    });
  });

  it("reveals every focused relation endpoint within the safety ceiling", () => {
    const focusedNodes = [
      ...nodes,
      { id: "entity-c", kind: "entity", sourceId: "source-a", active: true },
      { id: "entity-d", kind: "entity", sourceId: "source-a", active: true },
      { id: "entity-e", kind: "entity", sourceId: "source-a", active: true },
    ] satisfies UniversePreviewNode[];
    const focusedAdjacency = new Map(adjacency);
    focusedAdjacency.set("event-a", new Set([
      "entity-shared",
      "entity-a",
      "entity-c",
      "entity-d",
      "entity-e",
    ]));

    expect(plan({
      nodes: focusedNodes,
      adjacency: focusedAdjacency,
      focusId: "event-a",
      eventPreviewCount: 1,
    })).toMatchObject({
      eventIds: ["event-a"],
      entityIds: [
        "entity-shared",
        "entity-a",
        "entity-c",
        "entity-d",
        "entity-e",
      ],
      hiddenRelatedEntityCount: 0,
    });
  });

  it("never crosses sources and reports entity overflow", () => {
    expect(plan({
      focusId: "event-a",
      eventPreviewCount: 1,
      entitySafetyMax: 1,
    })).toEqual({
      ids: ["event-a", "entity-shared"],
      eventIds: ["event-a"],
      entityIds: ["entity-shared"],
      focused: true,
      hiddenRelatedEntityCount: 1,
    });
  });

  it("returns no cards when resting previews are disabled", () => {
    expect(plan({ cardsEnabled: false })).toEqual({
      ids: [],
      eventIds: [],
      entityIds: [],
      focused: false,
      hiddenRelatedEntityCount: 0,
    });
  });
});
