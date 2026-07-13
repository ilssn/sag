import { describe, expect, it } from "vitest";

import type { UniverseActivation, UniverseGraphPatch } from "./types";
import {
  emptyUniverseWorkingSet,
  mergeUniverseActivation,
  mergeUniverseGraphPatch,
  replaceUniverseWorkingSet,
  sourceTimelinePageTargetForLod,
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
  it("evicts nodes in exact FIFO order", () => {
    let current = emptyUniverseWorkingSet(1);
    for (const id of ["a", "b", "c", "d", "e"]) {
      current = mergeUniverseActivation(current, {
        epoch: 1,
        query: id,
        nodes: [{ id, kind: "entity", source_id: "source-a", label: id }],
        relations: [],
      }, { nodes: 3, edges: 3 });
    }

    expect(current.node_order).toEqual([
      "source-a:entity:c",
      "source-a:entity:d",
      "source-a:entity:e",
    ]);
    expect(current.nodes.map((node) => node.id)).toEqual(["c", "d", "e"]);
  });

  it("updates an existing node without moving it to the FIFO tail", () => {
    let current = mergeUniverseActivation(emptyUniverseWorkingSet(2), {
      epoch: 2,
      query: "initial",
      nodes: ["a", "b", "c"].map((id) => ({
        id,
        kind: "entity" as const,
        source_id: "source-a",
        label: id,
      })),
      relations: [],
    }, { nodes: 3, edges: 3 });
    current = mergeUniverseActivation(current, {
      epoch: 2,
      query: "update",
      nodes: [{ id: "b", kind: "entity", source_id: "source-a", label: "B updated" }],
      relations: [],
    }, { nodes: 3, edges: 3 });

    expect(current.node_order).toEqual([
      "source-a:entity:a",
      "source-a:entity:b",
      "source-a:entity:c",
    ]);
    expect(current.nodes.find((node) => node.id === "b")?.label).toBe("B updated");

    for (const id of ["d", "e"]) {
      current = mergeUniverseActivation(current, {
        epoch: 2,
        query: id,
        nodes: [{ id, kind: "entity", source_id: "source-a", label: id }],
        relations: [],
      }, { nodes: 3, edges: 3 });
    }
    expect(current.nodes.map((node) => node.id)).toEqual(["c", "d", "e"]);
  });

  it("protects a newly inserted batch while evicting enough oldest nodes", () => {
    const current = mergeUniverseActivation(emptyUniverseWorkingSet(3), {
      epoch: 3,
      query: "initial",
      nodes: ["a", "b", "c", "d"].map((id) => ({
        id,
        kind: "entity" as const,
        source_id: "source-a",
        label: id,
      })),
      relations: [],
    }, { nodes: 4, edges: 4 });
    const merged = mergeUniverseActivation(current, {
      epoch: 3,
      query: "batch",
      nodes: ["e", "f"].map((id) => ({
        id,
        kind: "entity" as const,
        source_id: "source-a",
        label: id,
      })),
      relations: [],
    }, { nodes: 4, edges: 4 });

    expect(merged.nodes.map((node) => node.id)).toEqual(["c", "d", "e", "f"]);
  });

  it("admits a clicked expansion after initial roots fill the whole budget", () => {
    const current = replaceUniverseWorkingSet({
      epoch: 4,
      query: "roots",
      nodes: ["root", "old-a", "old-b", "old-c"].map((id) => ({
        id,
        kind: "event" as const,
        source_id: "source-a",
        label: id,
      })),
      relations: [],
    }, { nodes: 4, edges: 4 });
    const nextPatch = patch(4, 99);
    nextPatch.anchor = { ...nextPatch.anchor, id: "root" };
    nextPatch.relations = [{
      source_id: "source-a",
      from_id: "root",
      to_id: "entity-99",
      kind: "mentions",
      weight: 1,
      description: "",
    }];

    const merged = mergeUniverseGraphPatch(current, nextPatch, { nodes: 4, edges: 4 });
    expect(merged.nodes.map((node) => node.id)).toEqual([
      "root",
      "old-b",
      "old-c",
      "entity-99",
    ]);
    expect(merged.root_keys).not.toContain("source-a:event:old-a");
  });

  it("shrinks immediately and can temporarily protect a selected old node", () => {
    const current = mergeUniverseActivation(emptyUniverseWorkingSet(5), {
      epoch: 5,
      query: "large",
      nodes: ["a", "b", "c", "d", "e"].map((id) => ({
        id,
        kind: "entity" as const,
        source_id: "source-a",
        label: id,
      })),
      relations: [],
    }, { nodes: 5, edges: 5 });

    const shrunk = trimUniverseWorkingSet(current, { nodes: 3, edges: 3 });
    expect(shrunk.nodes.map((node) => node.id)).toEqual(["c", "d", "e"]);

    const protectedShrink = trimUniverseWorkingSet(
      current,
      { nodes: 3, edges: 3 },
      ["source-a:entity:a"],
    );
    expect(protectedShrink.nodes.map((node) => node.id)).toEqual(["a", "d", "e"]);
  });

  it("keeps the newest valid edges when the edge budget is exceeded", () => {
    let current = replaceUniverseWorkingSet({
      epoch: 6,
      query: "root",
      nodes: [{
        id: "root-event",
        kind: "event",
        source_id: "source-a",
        label: "root",
      }],
      relations: [],
    }, { nodes: 10, edges: 2 });
    for (let index = 0; index < 3; index += 1) {
      current = mergeUniverseGraphPatch(current, patch(6, index), { nodes: 10, edges: 2 });
    }

    expect(current.relations.map((relation) => relation.to_id)).toEqual([
      "entity-1",
      "entity-2",
    ]);
    const withoutEdges = trimUniverseWorkingSet(current, { nodes: 10, edges: 0 });
    expect(withoutEdges.relations).toEqual([]);
  });

  it("advances deep LOD one page at a time", () => {
    expect(sourceTimelinePageTargetForLod(1, 0)).toBe(0);
    expect(sourceTimelinePageTargetForLod(2, 0)).toBe(1);
    expect(sourceTimelinePageTargetForLod(3, 0)).toBe(1);
    expect(sourceTimelinePageTargetForLod(2, 2)).toBe(2);
    expect(sourceTimelinePageTargetForLod(3, 2)).toBe(3);
  });

  it("keeps the initial event bundle as protected exploration roots", () => {
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

  it("enforces budgets while preserving the root and newest expansion", () => {
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
    expect(current.nodes.some((node) => node.id === "entity-0")).toBe(false);
    expect(current.nodes.some((node) => node.id === "entity-99")).toBe(true);
    expect(current.relations.some((relation) => relation.to_id === "entity-99")).toBe(true);
  });

  it("keeps every node in a fitting event bundle when older branches are evicted", () => {
    let current = replaceUniverseWorkingSet({
      epoch: 6,
      query: "old",
      nodes: [{
        id: "old-event-0",
        kind: "event",
        source_id: "source-a",
        label: "根事件",
      }],
      relations: [],
    }, { nodes: 5, edges: 5 });
    for (let index = 1; index <= 4; index += 1) {
      const oldPatch = patch(6, index);
      oldPatch.anchor = { ...oldPatch.anchor, id: "old-event-0" };
      oldPatch.relations = [{
        source_id: "source-a",
        from_id: "old-event-0",
        to_id: `entity-${index}`,
        kind: "mentions",
        weight: 1,
        description: "",
      }];
      current = mergeUniverseGraphPatch(current, oldPatch, { nodes: 5, edges: 5 });
    }
    const bundle = patch(6, 40);
    bundle.anchor = {
      ...bundle.anchor,
      id: "old-event-0",
      related_count: 2,
    };
    bundle.nodes.push({
      ...bundle.nodes[0],
      id: "entity-41",
      label: "实体 41",
    });
    bundle.relations = [40, 41].map((index) => ({
      source_id: "source-a",
      from_id: "old-event-0",
      to_id: `entity-${index}`,
      kind: "mentions" as const,
      weight: 1,
      description: "",
    }));

    const merged = mergeUniverseGraphPatch(current, bundle, { nodes: 5, edges: 5 });
    expect(merged.nodes.some((node) => node.id === "entity-40")).toBe(true);
    expect(merged.nodes.some((node) => node.id === "entity-41")).toBe(true);
    expect(merged.relations.filter(
      (relation) => relation.to_id === "entity-40" || relation.to_id === "entity-41",
    )).toHaveLength(2);
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
