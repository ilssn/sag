import { describe, expect, it } from "vitest";

import type { UniverseWorkingNode, UniverseWorkingSet } from "./universe-working-set";
import {
  DEFAULT_UNIVERSE_VIEW_PREFERENCES,
  UNIVERSE_VIEW_LIMITS,
  effectiveUniverseBudget,
  loadUniverseEntityCategories,
  normalizeUniverseViewPreferences,
  publishUniverseEntityCategories,
  projectUniverseWorkingSet,
  shouldAutoLoadUniverseTimeline,
  universeLabelBudget,
  type UniverseViewPreferences,
} from "./universe-view-preferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function preferences(
  patch: Partial<UniverseViewPreferences> = {},
): UniverseViewPreferences {
  return normalizeUniverseViewPreferences({
    ...DEFAULT_UNIVERSE_VIEW_PREFERENCES,
    ...patch,
  });
}

function node(
  id: string,
  kind: "event" | "entity",
  category = "",
): UniverseWorkingNode {
  return {
    id,
    kind,
    source_id: "source-a",
    label: id,
    category,
    touched_at: 1,
    root: true,
  };
}

function workingSet(nodes: UniverseWorkingNode[]): UniverseWorkingSet {
  return {
    epoch: 7,
    nodes,
    relations: [
      {
        source_id: "source-a",
        from_id: "event-1",
        to_id: "person-1",
        kind: "mentions",
        weight: 1,
        description: "",
      },
      {
        source_id: "source-a",
        from_id: "event-2",
        to_id: "org-1",
        kind: "mentions",
        weight: 1,
        description: "",
      },
      {
        source_id: "source-a",
        from_id: "event-1",
        to_id: "event-2",
        kind: "subevent",
        weight: 1,
        description: "",
      },
    ],
    root_keys: nodes.map((item) => `source-a:${item.kind}:${item.id}`),
    node_order: nodes.map((item) => `source-a:${item.kind}:${item.id}`),
  };
}

describe("universe view preference normalization", () => {
  it("repairs untrusted values, de-duplicates filters and upgrades the schema", () => {
    expect(normalizeUniverseViewPreferences({
      version: -1,
      maxNodes: 99_999,
      visibleKinds: ["entity", "unknown", "entity"],
      entityCategories: [" Person ", "", "Person", 42],
      priority: "newest",
      labelDensity: "maximum",
      edgeDensity: "everything",
      browseAutoExpand: false,
    })).toEqual({
      version: 1,
      maxNodes: UNIVERSE_VIEW_LIMITS.maxNodes.max,
      visibleKinds: ["entity"],
      entityCategories: ["Person"],
      priority: "balanced",
      labelDensity: "balanced",
      edgeDensity: "focus",
      browseAutoExpand: false,
    });
  });

  it("never allows an empty visible kind selection", () => {
    const normalized = normalizeUniverseViewPreferences({
      maxNodes: -10,
      visibleKinds: [],
    });
    expect(normalized.visibleKinds).toEqual(["event", "entity"]);
    expect(normalized.maxNodes).toBe(UNIVERSE_VIEW_LIMITS.maxNodes.min);
  });
});

describe("universe rendering budgets", () => {
  it("combines policy and user node caps and scales edge detail monotonically", () => {
    const policy = { nodes: 800, edges: 1500 };
    const focus = effectiveUniverseBudget(policy, 500, "focus");
    const context = effectiveUniverseBudget(policy, 500, "context");
    const all = effectiveUniverseBudget(policy, 500, "all");

    expect(focus).toEqual({ nodes: 500, edges: 625 });
    expect(context).toEqual({ nodes: 500, edges: 1250 });
    expect(all).toEqual({ nodes: 500, edges: 1500 });
  });

  it("never exceeds a smaller renderer policy", () => {
    expect(effectiveUniverseBudget({ nodes: 24, edges: 30 }, 500, "all"))
      .toEqual({ nodes: 24, edges: 30 });
  });
});

describe("universe working-set projection", () => {
  const current = workingSet([
    node("event-1", "event"),
    node("person-1", "entity", "Person"),
    node("event-2", "event"),
    node("org-1", "entity", "Organization"),
    node("person-2", "entity", "Person"),
  ]);

  it("filters categories, removes dangling edges and stably honors kind priority", () => {
    const projected = projectUniverseWorkingSet(current, preferences({
      entityCategories: ["Person"],
      priority: "entities",
    }));

    expect(projected.nodes.map((item) => item.id)).toEqual([
      "person-1",
      "person-2",
      "event-1",
      "event-2",
    ]);
    expect(projected.relations.map((relation) => relation.kind)).toEqual([
      "mentions",
      "subevent",
    ]);
    expect(projected.root_keys).not.toContain("source-a:entity:org-1");
    expect(current.nodes.map((item) => item.id)).toEqual([
      "event-1",
      "person-1",
      "event-2",
      "org-1",
      "person-2",
    ]);
  });

  it("removes every relation whose event endpoint is hidden", () => {
    const projected = projectUniverseWorkingSet(current, preferences({
      visibleKinds: ["entity"],
    }));
    expect(projected.nodes.every((item) => item.kind === "entity")).toBe(true);
    expect(projected.relations).toEqual([]);
  });

  it("caps the projection after applying priority without disturbing stable order", () => {
    const manyNodes = [
      node("entity-anchor", "entity"),
      ...Array.from({ length: UNIVERSE_VIEW_LIMITS.maxNodes.min + 1 }, (_, index) =>
        node(`event-${index}`, "event")),
    ];
    const projected = projectUniverseWorkingSet(
      workingSet(manyNodes),
      preferences({
        maxNodes: UNIVERSE_VIEW_LIMITS.maxNodes.min,
        priority: "events",
      }),
    );

    expect(projected.nodes).toHaveLength(UNIVERSE_VIEW_LIMITS.maxNodes.min);
    expect(projected.nodes[0]?.id).toBe("event-0");
    expect(projected.nodes.at(-1)?.id).toBe(
      `event-${UNIVERSE_VIEW_LIMITS.maxNodes.min - 1}`,
    );
  });
});

describe("adaptive universe labels", () => {
  it("increases monotonically with density", () => {
    const low = universeLabelBudget(1280, 720, "low", "balanced", ["event", "entity"]);
    const balanced = universeLabelBudget(
      1280,
      720,
      "balanced",
      "balanced",
      ["event", "entity"],
    );
    const high = universeLabelBudget(1280, 720, "high", "balanced", ["event", "entity"]);

    expect(low.total).toBeLessThan(balanced.total);
    expect(balanced.total).toBeLessThan(high.total);
  });

  it("allocates labels to the selected kind and shifts the share by priority", () => {
    const events = universeLabelBudget(
      1280,
      720,
      "balanced",
      "events",
      ["event", "entity"],
    );
    const entities = universeLabelBudget(
      1280,
      720,
      "balanced",
      "entities",
      ["event", "entity"],
    );
    const onlyEntities = universeLabelBudget(
      1280,
      720,
      "balanced",
      "events",
      ["entity"],
    );

    expect(events.events).toBeGreaterThan(entities.events);
    expect(events.total).toBe(entities.total);
    expect(onlyEntities).toEqual({
      events: 0,
      entities: onlyEntities.total,
      total: onlyEntities.total,
    });
  });
});

describe("timeline auto-loading policy", () => {
  it("locks search and assistant activations while preserving optional browsing LOD", () => {
    expect(shouldAutoLoadUniverseTimeline("search", 3, true)).toBe(false);
    expect(shouldAutoLoadUniverseTimeline("assistant", 3, true)).toBe(false);
    expect(shouldAutoLoadUniverseTimeline("browse", 1, true)).toBe(false);
    expect(shouldAutoLoadUniverseTimeline("browse", 2, true)).toBe(true);
    expect(shouldAutoLoadUniverseTimeline("browse", 3, false)).toBe(false);
  });
});

describe("universe entity category registry", () => {
  it("merges, trims and sorts discovered categories for the settings page", () => {
    const storage = memoryStorage();

    publishUniverseEntityCategories([" organization ", "concept"], storage);
    publishUniverseEntityCategories(["location", "concept", ""], storage);

    expect(loadUniverseEntityCategories(storage)).toEqual([
      "concept",
      "location",
      "organization",
    ]);
  });

  it("recovers safely from malformed persisted data", () => {
    const storage = memoryStorage({
      "sag:universe-entity-categories": "not-json",
    });
    expect(loadUniverseEntityCategories(storage)).toEqual([]);
  });
});
