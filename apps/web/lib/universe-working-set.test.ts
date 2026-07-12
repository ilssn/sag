import { describe, expect, it } from "vitest";

import type { UniverseActivation, UniverseGraphPatch } from "./types";
import {
  emptyUniverseWorkingSet,
  mergeUniverseActivation,
  mergeUniverseGraphPatch,
  replaceUniverseWorkingSet,
  sourceEntityPageTargetForLod,
  trimUniverseWorkingSet,
  universeAnchorProgress,
} from "./universe-working-set";

function activation(epoch: number, prefix: string, count = 4): UniverseActivation {
  const events = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-event-${index}`,
    kind: "event" as const,
    source_id: "source-a",
    label: `事件 ${index}`,
  }));
  const entities = Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-entity-${index}`,
    kind: "entity" as const,
    source_id: "source-a",
    label: `实体 ${index}`,
  }));
  return {
    epoch,
    query: prefix,
    nodes: [...events, ...entities],
    relations: events.map((event, index) => ({
      source_id: "source-a",
      from_id: event.id,
      to_id: entities[index].id,
      kind: "mentions" as const,
      weight: 1,
      description: "",
    })),
  };
}

function patch(epoch: number, index: number): UniverseGraphPatch {
  return {
    epoch,
    anchor: {
      id: "root-event",
      kind: "event",
      source_id: "source-a",
      label: "根事件",
      description: "",
      category: "事件",
      chunk_id: null,
      start_time: null,
      importance: 1,
      related_count: 0,
      state: "active",
    },
    nodes: [
      {
        id: `entity-${index}`,
        kind: "entity",
        source_id: "source-a",
        label: `实体 ${index}`,
        description: "",
        category: "实体",
        chunk_id: null,
        start_time: null,
        importance: 0.5,
        related_count: 1,
        state: "active",
      },
    ],
    relations: [
      {
        source_id: "source-a",
        from_id: "root-event",
        to_id: `entity-${index}`,
        kind: "mentions",
        weight: 1,
        description: "",
      },
    ],
    page: {
      returned: 1,
      has_more: index < 99,
      next_cursor: index < 99 ? `cursor-${index}` : null,
    },
    as_of: "2026-07-12T00:00:00Z",
  };
}

describe("universe working set", () => {
  it("advances deep LOD one page at a time", () => {
    expect(sourceEntityPageTargetForLod(1, 0)).toBe(0);
    expect(sourceEntityPageTargetForLod(2, 0)).toBe(1);
    expect(sourceEntityPageTargetForLod(3, 0)).toBe(1);
    expect(sourceEntityPageTargetForLod(2, 2)).toBe(2);
    expect(sourceEntityPageTargetForLod(3, 2)).toBe(3);
  });

  it("keeps source entity pages as protected exploration roots", () => {
    const current = mergeUniverseActivation(
      emptyUniverseWorkingSet(9),
      {
        epoch: 9,
        query: "source",
        nodes: Array.from({ length: 6 }, (_, index) => ({
          id: `entity-${index}`,
          kind: "entity" as const,
          source_id: "source-a",
          label: `实体 ${index}`,
        })),
        relations: [],
      },
      { nodes: 4, edges: 4 },
      1,
      { roots: true },
    );

    expect(current.nodes).toHaveLength(4);
    expect(current.nodes.every((node) => node.root)).toBe(true);
    expect(current.root_keys).toHaveLength(4);
  });

  it("replaces instead of accumulating across searches", () => {
    const first = replaceUniverseWorkingSet(activation(1, "first"), { nodes: 20, edges: 20 });
    const second = replaceUniverseWorkingSet(activation(2, "second"), { nodes: 20, edges: 20 });

    expect(first.nodes.some((node) => node.id.startsWith("first"))).toBe(true);
    expect(second.nodes.every((node) => node.id.startsWith("second"))).toBe(true);
    expect(second.epoch).toBe(2);
  });

  it("ignores a late expansion from an older epoch", () => {
    const current = replaceUniverseWorkingSet(activation(8, "current", 1), {
      nodes: 20,
      edges: 20,
    });
    const late = mergeUniverseGraphPatch(current, patch(7, 1), { nodes: 20, edges: 20 });

    expect(late).toBe(current);
  });

  it("hydrates a latent timeline star in place when it is expanded", () => {
    const latent = mergeUniverseActivation(
      {
        epoch: 6,
        nodes: [],
        relations: [],
        root_keys: [],
      },
      {
        epoch: 6,
        query: "timeline",
        nodes: [
          {
            id: "root-event",
            kind: "event",
            source_id: "source-a",
            label: "",
            state: "latent",
          },
        ],
        relations: [],
      },
      { nodes: 20, edges: 20 },
      1,
    );
    const hydrated = mergeUniverseGraphPatch(latent, patch(6, 1), {
      nodes: 20,
      edges: 20,
    }, 2);

    const root = hydrated.nodes.find((node) => node.id === "root-event");
    expect(root?.label).toBe("根事件");
    expect(root?.state).toBe("active");
    expect(hydrated.nodes.filter((node) => node.id === "root-event")).toHaveLength(1);
  });

  it("counts committed neighbors by source and anchor kind", () => {
    const current = replaceUniverseWorkingSet(activation(3, "count", 3), {
      nodes: 12,
      edges: 12,
    });

    expect(universeAnchorProgress(current, "event", "count-event-1", "source-a")).toBe(1);
    expect(universeAnchorProgress(current, "entity", "count-entity-1", "source-a")).toBe(1);
    expect(universeAnchorProgress(current, "entity", "count-entity-1", "source-b")).toBe(0);
  });

  it("keeps identical raw ids isolated by source", () => {
    const current = replaceUniverseWorkingSet(
      {
        epoch: 4,
        query: "multi-source",
        nodes: ["source-a", "source-b"].flatMap((sourceId) => [
          {
            id: "same-event",
            kind: "event" as const,
            source_id: sourceId,
            label: sourceId,
          },
          {
            id: "same-entity",
            kind: "entity" as const,
            source_id: sourceId,
            label: sourceId,
          },
        ]),
        relations: ["source-a", "source-b"].map((sourceId) => ({
          source_id: sourceId,
          from_id: "same-event",
          to_id: "same-entity",
          kind: "mentions" as const,
          weight: 1,
          description: "",
        })),
      },
      { nodes: 10, edges: 10 },
    );

    expect(current.nodes).toHaveLength(4);
    expect(current.relations).toHaveLength(2);
  });

  it("enforces budgets without evicting the activated connected set", () => {
    const rootActivation: UniverseActivation = {
      epoch: 5,
      query: "root",
      nodes: [
        {
          id: "root-event",
          kind: "event",
          source_id: "source-a",
          label: "根事件",
        },
      ],
      relations: [],
    };
    let current = replaceUniverseWorkingSet(rootActivation, { nodes: 10, edges: 12 });
    for (let index = 0; index < 100; index += 1) {
      current = mergeUniverseGraphPatch(current, patch(5, index), {
        nodes: 10,
        edges: 12,
      }, index + 1);
      expect(current.nodes.length).toBeLessThanOrEqual(10);
      expect(current.relations.length).toBeLessThanOrEqual(12);
      const nodeIds = new Set(current.nodes.map((node) => node.id));
      current.relations.forEach((relation) => {
        expect(nodeIds.has(relation.from_id)).toBe(true);
        expect(nodeIds.has(relation.to_id)).toBe(true);
      });
    }
    expect(current.nodes.some((node) => node.id === "root-event")).toBe(true);
    expect(current.nodes.some((node) => node.id === "entity-0")).toBe(true);
    expect(current.nodes.some((node) => node.id === "entity-99")).toBe(false);
    expect(current.relations.some((relation) => relation.to_id === "entity-0")).toBe(true);
  });

  it("immediately trims to the mobile budget", () => {
    const desktop = replaceUniverseWorkingSet(activation(3, "mobile", 30), {
      nodes: 80,
      edges: 80,
    });
    const mobile = trimUniverseWorkingSet(desktop, { nodes: 12, edges: 20 });

    expect(mobile.nodes).toHaveLength(12);
    expect(mobile.relations.length).toBeLessThanOrEqual(20);
  });
});
