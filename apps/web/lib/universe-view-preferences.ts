"use client";

import * as React from "react";

import type { UniverseActivationOrigin, UniverseNodeKind } from "./types";
import {
  universeNodeKey,
  type UniverseWorkingSet,
} from "./universe-working-set";

export const UNIVERSE_VIEW_PREFERENCES_VERSION = 1;
export const UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY =
  "sag:universe-view-preferences";
export const UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY =
  "sag:universe-entity-categories";

const UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT =
  "sag:universe-view-preferences-change";
const UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT =
  "sag:universe-entity-categories-change";
const MAX_REMEMBERED_ENTITY_CATEGORIES = 64;

export type UniverseViewPriority = "balanced" | "events" | "entities";
export type UniverseLabelDensity = "low" | "balanced" | "high";
export type UniverseEdgeDensity = "focus" | "context" | "all";

export interface UniverseViewPreferences {
  version: number;
  maxNodes: number;
  visibleKinds: UniverseNodeKind[];
  /** `null` means every entity category is visible. */
  entityCategories: string[] | null;
  priority: UniverseViewPriority;
  labelDensity: UniverseLabelDensity;
  edgeDensity: UniverseEdgeDensity;
  browseAutoExpand: boolean;
}

/**
 * Limits shared by normalization, UI controls and rendering budget projection.
 * The user budget is intentionally a soft cap below the renderer's policy cap.
 */
export const UNIVERSE_VIEW_LIMITS = {
  maxNodes: {
    min: 40,
    max: 600,
    step: 20,
    default: 240,
  },
  edgePerNode: {
    focus: 1.25,
    context: 2.5,
    all: 4,
  },
  labels: {
    low: { areaPerLabel: 140_000, max: 18 },
    balanced: { areaPerLabel: 80_000, max: 32 },
    high: { areaPerLabel: 48_000, max: 48 },
  },
  labelEventShare: {
    balanced: 0.42,
    events: 0.7,
    entities: 0.22,
  },
  timelineAutoLoadMinLevel: 2,
} as const;

export const DEFAULT_UNIVERSE_VIEW_PREFERENCES: Readonly<UniverseViewPreferences> =
  Object.freeze({
    version: UNIVERSE_VIEW_PREFERENCES_VERSION,
    maxNodes: UNIVERSE_VIEW_LIMITS.maxNodes.default,
    visibleKinds: Object.freeze(["event", "entity"]) as unknown as UniverseNodeKind[],
    entityCategories: null,
    priority: "balanced",
    labelDensity: "balanced",
    edgeDensity: "focus",
    browseAutoExpand: true,
  });

// Short aliases keep call sites readable while retaining descriptive exports.
export const UNIVERSE_VIEW_DEFAULTS = DEFAULT_UNIVERSE_VIEW_PREFERENCES;
export const UNIVERSE_VIEW_PREFERENCE_LIMITS = UNIVERSE_VIEW_LIMITS;

const NODE_KINDS = ["event", "entity"] as const;
const PRIORITIES = ["balanced", "events", "entities"] as const;
const LABEL_DENSITIES = ["low", "balanced", "high"] as const;
const EDGE_DENSITIES = ["focus", "context", "all"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function finiteInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cloneDefaultPreferences(): UniverseViewPreferences {
  return {
    ...DEFAULT_UNIVERSE_VIEW_PREFERENCES,
    visibleKinds: [...DEFAULT_UNIVERSE_VIEW_PREFERENCES.visibleKinds],
    entityCategories: null,
  };
}

/** Converts persisted or partially trusted data into the current schema. */
export function normalizeUniverseViewPreferences(
  value: unknown,
): UniverseViewPreferences {
  const input = isRecord(value) ? value : {};
  const visibleKindValues = Array.isArray(input.visibleKinds)
    ? new Set(input.visibleKinds.filter((kind): kind is UniverseNodeKind =>
      isOneOf(kind, NODE_KINDS)))
    : new Set<UniverseNodeKind>();
  const visibleKinds = NODE_KINDS.filter((kind) => visibleKindValues.has(kind));

  let entityCategories: string[] | null = null;
  if (Array.isArray(input.entityCategories)) {
    entityCategories = [...new Set(input.entityCategories
      .filter((category): category is string => typeof category === "string")
      .map((category) => category.trim())
      .filter(Boolean))];
  }

  return {
    version: UNIVERSE_VIEW_PREFERENCES_VERSION,
    maxNodes: clamp(
      finiteInteger(input.maxNodes, UNIVERSE_VIEW_LIMITS.maxNodes.default),
      UNIVERSE_VIEW_LIMITS.maxNodes.min,
      UNIVERSE_VIEW_LIMITS.maxNodes.max,
    ),
    visibleKinds: visibleKinds.length > 0
      ? [...visibleKinds]
      : [...DEFAULT_UNIVERSE_VIEW_PREFERENCES.visibleKinds],
    entityCategories,
    priority: isOneOf(input.priority, PRIORITIES)
      ? input.priority
      : DEFAULT_UNIVERSE_VIEW_PREFERENCES.priority,
    labelDensity: isOneOf(input.labelDensity, LABEL_DENSITIES)
      ? input.labelDensity
      : DEFAULT_UNIVERSE_VIEW_PREFERENCES.labelDensity,
    edgeDensity: isOneOf(input.edgeDensity, EDGE_DENSITIES)
      ? input.edgeDensity
      : DEFAULT_UNIVERSE_VIEW_PREFERENCES.edgeDensity,
    browseAutoExpand: typeof input.browseAutoExpand === "boolean"
      ? input.browseAutoExpand
      : DEFAULT_UNIVERSE_VIEW_PREFERENCES.browseAutoExpand,
  };
}

export interface UniverseSceneBudget {
  nodes: number;
  edges: number;
}

/** Applies the user cap and edge-detail preference without exceeding policy. */
export function effectiveUniverseBudget(
  policyBudget: UniverseSceneBudget,
  userMaxNodes: number,
  edgeDensity: UniverseEdgeDensity,
): UniverseSceneBudget {
  const policyNodes = Math.max(0, finiteInteger(policyBudget.nodes, 0));
  const policyEdges = Math.max(0, finiteInteger(policyBudget.edges, 0));
  const requestedNodes = clamp(
    finiteInteger(userMaxNodes, UNIVERSE_VIEW_LIMITS.maxNodes.default),
    UNIVERSE_VIEW_LIMITS.maxNodes.min,
    UNIVERSE_VIEW_LIMITS.maxNodes.max,
  );
  const nodes = Math.min(policyNodes, requestedNodes);
  const density = isOneOf(edgeDensity, EDGE_DENSITIES)
    ? edgeDensity
    : DEFAULT_UNIVERSE_VIEW_PREFERENCES.edgeDensity;
  const desiredEdges = Math.ceil(nodes * UNIVERSE_VIEW_LIMITS.edgePerNode[density]);
  return {
    nodes,
    edges: Math.min(policyEdges, desiredEdges),
  };
}

function priorityRank(kind: UniverseNodeKind, priority: UniverseViewPriority) {
  if (priority === "events") return kind === "event" ? 0 : 1;
  if (priority === "entities") return kind === "entity" ? 0 : 1;
  return 0;
}

/**
 * Derives a renderable view without mutating the FIFO working set. Sorting is
 * stable, so each kind keeps its admission order when a priority is selected.
 */
export function projectUniverseWorkingSet(
  current: UniverseWorkingSet,
  preferences: UniverseViewPreferences,
): UniverseWorkingSet {
  const normalized = normalizeUniverseViewPreferences(preferences);
  const visibleKinds = new Set(normalized.visibleKinds);
  const visibleCategories = normalized.entityCategories === null
    ? null
    : new Set(normalized.entityCategories);

  const nodes = current.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => {
      if (!visibleKinds.has(node.kind)) return false;
      if (node.kind !== "entity" || visibleCategories === null) return true;
      return visibleCategories.has((node.category ?? "").trim());
    })
    .sort((left, right) => {
      const rank = priorityRank(left.node.kind, normalized.priority)
        - priorityRank(right.node.kind, normalized.priority);
      return rank || left.index - right.index;
    })
    .slice(0, normalized.maxNodes)
    .map(({ node }) => node);

  const keptKeys = new Set(nodes.map((node) =>
    universeNodeKey(node.kind, node.id, node.source_id)));
  const relations = current.relations.filter((relation) => {
    const targetKind = relation.kind === "subevent" ? "event" : "entity";
    return keptKeys.has(universeNodeKey("event", relation.from_id, relation.source_id))
      && keptKeys.has(universeNodeKey(targetKind, relation.to_id, relation.source_id));
  });
  const nodeOrder = nodes.map((node) =>
    universeNodeKey(node.kind, node.id, node.source_id));

  return {
    ...current,
    nodes,
    relations,
    root_keys: current.root_keys.filter((key) => keptKeys.has(key)),
    node_order: nodeOrder,
  };
}

export interface UniverseLabelBudget {
  events: number;
  entities: number;
  total: number;
}

/** Calculates an adaptive label cap from viewport area and display intent. */
export function universeLabelBudget(
  width: number,
  height: number,
  density: UniverseLabelDensity,
  priority: UniverseViewPriority,
  visibleKinds: UniverseNodeKind[],
): UniverseLabelBudget {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const kinds = new Set(visibleKinds.filter((kind) => isOneOf(kind, NODE_KINDS)));
  if (safeWidth === 0 || safeHeight === 0 || kinds.size === 0) {
    return { events: 0, entities: 0, total: 0 };
  }

  const safeDensity = isOneOf(density, LABEL_DENSITIES)
    ? density
    : DEFAULT_UNIVERSE_VIEW_PREFERENCES.labelDensity;
  const safePriority = isOneOf(priority, PRIORITIES)
    ? priority
    : DEFAULT_UNIVERSE_VIEW_PREFERENCES.priority;
  const limit = UNIVERSE_VIEW_LIMITS.labels[safeDensity];
  const total = Math.max(0, Math.min(
    limit.max,
    Math.floor((safeWidth * safeHeight) / limit.areaPerLabel),
  ));

  if (total === 0) return { events: 0, entities: 0, total: 0 };

  if (!kinds.has("entity")) return { events: total, entities: 0, total };
  if (!kinds.has("event")) return { events: 0, entities: total, total };

  const eventShare = UNIVERSE_VIEW_LIMITS.labelEventShare[safePriority];
  const events = total === 1
    ? (safePriority === "entities" ? 0 : 1)
    : clamp(Math.round(total * eventShare), 1, total - 1);
  return {
    events,
    entities: total - events,
    total,
  };
}

/** Search and assistant activations stay fixed; only browsing may follow LOD. */
export function shouldAutoLoadUniverseTimeline(
  origin: UniverseActivationOrigin,
  level: 0 | 1 | 2 | 3,
  browseAutoExpand: boolean,
) {
  return origin === "browse"
    && browseAutoExpand
    && level >= UNIVERSE_VIEW_LIMITS.timelineAutoLoadMinLevel;
}

type UniverseViewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): UniverseViewStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function dispatchBrowserEvent(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(name));
}

export function loadUniverseViewPreferences(
  storage: UniverseViewStorage | null = defaultStorage(),
): UniverseViewPreferences {
  if (!storage) return cloneDefaultPreferences();
  try {
    const raw = storage.getItem(UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY);
    return raw ? normalizeUniverseViewPreferences(JSON.parse(raw)) : cloneDefaultPreferences();
  } catch {
    return cloneDefaultPreferences();
  }
}

export function saveUniverseViewPreferences(
  preferences: UniverseViewPreferences,
  storage: UniverseViewStorage | null = defaultStorage(),
): UniverseViewPreferences {
  const normalized = normalizeUniverseViewPreferences(preferences);
  if (!storage) return normalized;
  try {
    storage.setItem(
      UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // Storage can be unavailable (private mode, quota, or embedded contexts).
  }
  return normalized;
}

export type UniverseViewPreferencesUpdate =
  | Partial<UniverseViewPreferences>
  | ((current: UniverseViewPreferences) => Partial<UniverseViewPreferences>);

export function updateStoredUniverseViewPreferences(
  update: UniverseViewPreferencesUpdate,
  storage: UniverseViewStorage | null = defaultStorage(),
) {
  const current = loadUniverseViewPreferences(storage);
  const patch = typeof update === "function" ? update(current) : update;
  return saveUniverseViewPreferences({ ...current, ...patch }, storage);
}

export function resetStoredUniverseViewPreferences(
  storage: UniverseViewStorage | null = defaultStorage(),
) {
  try {
    storage?.removeItem(UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY);
  } catch {
    // Reset still succeeds in memory if persistent storage is unavailable.
  }
  return cloneDefaultPreferences();
}

export interface UseUniverseViewPreferencesResult {
  preferences: UniverseViewPreferences;
  updatePreferences: (update: UniverseViewPreferencesUpdate) => void;
  resetPreferences: () => void;
}

export function useUniverseViewPreferences(): UseUniverseViewPreferencesResult {
  const [preferences, setPreferences] = React.useState<UniverseViewPreferences>(
    cloneDefaultPreferences,
  );

  const updatePreferences = React.useCallback((update: UniverseViewPreferencesUpdate) => {
    const next = updateStoredUniverseViewPreferences(update);
    setPreferences(next);
    dispatchBrowserEvent(UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT);
  }, []);

  const resetPreferences = React.useCallback(() => {
    setPreferences(resetStoredUniverseViewPreferences());
    dispatchBrowserEvent(UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT);
  }, []);

  React.useEffect(() => {
    // Keep the server snapshot deterministic, then hydrate browser preferences.
    setPreferences(loadUniverseViewPreferences());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY
        || event.key === null
      ) {
        setPreferences(loadUniverseViewPreferences());
      }
    };
    const onPreferenceChange = () => {
      setPreferences(loadUniverseViewPreferences());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT,
      onPreferenceChange,
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT,
        onPreferenceChange,
      );
    };
  }, []);

  return { preferences, updatePreferences, resetPreferences };
}

function normalizeEntityCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((category): category is string => typeof category === "string")
    .map((category) => category.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .slice(0, MAX_REMEMBERED_ENTITY_CATEGORIES);
}

/** Keeps the settings page useful even while the background renderer is asleep. */
export function loadUniverseEntityCategories(
  storage: UniverseViewStorage | null = defaultStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY);
    return raw ? normalizeEntityCategories(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function publishUniverseEntityCategories(
  categories: string[],
  storage: UniverseViewStorage | null = defaultStorage(),
) {
  const current = loadUniverseEntityCategories(storage);
  const next = normalizeEntityCategories([...current, ...categories]);
  if (next.join("\u0000") === current.join("\u0000")) return current;
  try {
    storage?.setItem(
      UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // The current graph still supplies its categories when storage is unavailable.
  }
  dispatchBrowserEvent(UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT);
  return next;
}

export function useUniverseEntityCategories() {
  const [categories, setCategories] = React.useState<string[]>([]);

  React.useEffect(() => {
    const refresh = () => setCategories(loadUniverseEntityCategories());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY
        || event.key === null
      ) {
        refresh();
      }
    };
    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT, refresh);
    };
  }, []);

  return categories;
}
