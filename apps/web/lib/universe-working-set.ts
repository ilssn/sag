import type {
  UniverseActivation,
  UniverseActivationNode,
  UniverseGraphPatch,
  UniverseNodeKind,
  UniverseRelation,
} from "./types";

export const UNIVERSE_SCENE_BUDGET = {
  desktop: { nodes: 2000, edges: 5000 },
  mobile: { nodes: 800, edges: 1500 },
} as const;

export function sourceEntityPageTargetForLod(
  level: 0 | 1 | 2 | 3,
  loadedPages: number,
) {
  if (level < 2) return loadedPages;
  if (level === 2) return Math.max(1, loadedPages);
  return loadedPages + 1;
}

export interface UniverseWorkingNode extends UniverseActivationNode {
  source_id: string;
  touched_at: number;
  root: boolean;
}

export interface UniverseWorkingSet {
  epoch: number;
  nodes: UniverseWorkingNode[];
  relations: UniverseRelation[];
  root_keys: string[];
}

export interface MergeUniverseActivationOptions {
  roots?: boolean;
}

export function universeNodeKey(
  kind: UniverseNodeKind,
  id: string,
  sourceId?: string | null,
) {
  return `${sourceId || "unknown"}:${kind}:${id}`;
}

export function emptyUniverseWorkingSet(epoch = 0): UniverseWorkingSet {
  return {
    epoch,
    nodes: [],
    relations: [],
    root_keys: [],
  };
}

function relationKey(relation: UniverseRelation) {
  return `${relation.source_id}:${relation.kind}:${relation.from_id}:${relation.to_id}`;
}

function bounded(
  value: UniverseWorkingSet,
  budget: { nodes: number; edges: number },
  protectedKeys: Set<string>,
): UniverseWorkingSet {
  const rootKeys = new Set(value.root_keys);
  const protectedNodes = value.nodes.filter((node) => {
    const key = universeNodeKey(node.kind, node.id, node.source_id);
    return protectedKeys.has(key) || rootKeys.has(key);
  });
  const protectedSlice = protectedNodes.slice(0, budget.nodes);
  const keptKeys = new Set(
    protectedSlice.map((node) => universeNodeKey(node.kind, node.id, node.source_id)),
  );
  const remaining = value.nodes
    .filter((node) => !keptKeys.has(universeNodeKey(node.kind, node.id, node.source_id)));
  const nodes = [...protectedSlice, ...remaining.slice(0, budget.nodes - protectedSlice.length)];
  const nodeKeys = new Set(
    nodes.map((node) => universeNodeKey(node.kind, node.id, node.source_id)),
  );
  const relations = value.relations
    .filter((relation) => {
      const targetKind = relation.kind === "subevent" ? "event" : "entity";
      return nodeKeys.has(universeNodeKey("event", relation.from_id, relation.source_id))
        && nodeKeys.has(universeNodeKey(targetKind, relation.to_id, relation.source_id));
    })
    .slice(0, budget.edges);
  return {
    ...value,
    nodes,
    relations,
    root_keys: value.root_keys.filter((key) => keptKeys.has(key) || nodes.some(
      (node) => universeNodeKey(node.kind, node.id, node.source_id) === key,
    )),
  };
}

export function trimUniverseWorkingSet(
  current: UniverseWorkingSet,
  budget: { nodes: number; edges: number },
): UniverseWorkingSet {
  return bounded(current, budget, new Set());
}

export function replaceUniverseWorkingSet(
  activation: UniverseActivation,
  budget: { nodes: number; edges: number },
  now = Date.now(),
): UniverseWorkingSet {
  const nodesByKey = new Map<string, UniverseWorkingNode>();
  for (const node of activation.nodes) {
    const sourceId = node.source_id || "";
    const normalized: UniverseWorkingNode = {
      ...node,
      source_id: sourceId,
      touched_at: now,
      root: true,
    };
    nodesByKey.set(universeNodeKey(node.kind, node.id, sourceId), normalized);
  }
  const relationMap = new Map<string, UniverseRelation>();
  activation.relations.forEach((relation) => relationMap.set(relationKey(relation), relation));
  const rootKeys = [...nodesByKey.keys()];
  return bounded(
    {
      epoch: activation.epoch ?? 0,
      nodes: [...nodesByKey.values()],
      relations: [...relationMap.values()],
      root_keys: rootKeys,
    },
    budget,
    new Set(rootKeys),
  );
}

export function mergeUniverseGraphPatch(
  current: UniverseWorkingSet,
  patch: UniverseGraphPatch,
  budget: { nodes: number; edges: number },
  now = Date.now(),
): UniverseWorkingSet {
  if (patch.epoch !== current.epoch) return current;
  const nodesByKey = new Map(
    current.nodes.map((node) => [universeNodeKey(node.kind, node.id, node.source_id), node]),
  );
  const anchorKey = universeNodeKey(
    patch.anchor.kind,
    patch.anchor.id,
    patch.anchor.source_id,
  );
  const anchor = nodesByKey.get(anchorKey);
  nodesByKey.set(anchorKey, {
    ...anchor,
    ...patch.anchor,
    source_id: patch.anchor.source_id,
    touched_at: now,
    root: anchor?.root ?? true,
    state: "active",
  });
  for (const node of patch.nodes) {
    const key = universeNodeKey(node.kind, node.id, node.source_id);
    const existing = nodesByKey.get(key);
    nodesByKey.set(key, {
      ...existing,
      ...node,
      source_id: node.source_id,
      touched_at: now,
      root: existing?.root ?? false,
    });
  }
  const relationMap = new Map<string, UniverseRelation>();
  current.relations.forEach((relation) => relationMap.set(relationKey(relation), relation));
  patch.relations.forEach((relation) => {
    relationMap.delete(relationKey(relation));
    relationMap.set(relationKey(relation), relation);
  });
  const committedKeys = new Set(
    current.nodes.map((node) => universeNodeKey(node.kind, node.id, node.source_id)),
  );
  committedKeys.add(anchorKey);
  return bounded(
    {
      ...current,
      nodes: [...nodesByKey.values()],
      relations: [...relationMap.values()],
    },
    budget,
    committedKeys,
  );
}

export function universeAnchorProgress(
  current: UniverseWorkingSet,
  kind: UniverseNodeKind,
  id: string,
  sourceId: string,
) {
  const neighborIds = new Set<string>();
  current.relations.forEach((relation) => {
    if (relation.source_id !== sourceId) return;
    if (kind === "event" && relation.from_id === id) {
      neighborIds.add(`${relation.kind}:${relation.to_id}`);
    }
    if (kind === "entity" && relation.kind === "mentions" && relation.to_id === id) {
      neighborIds.add(relation.from_id);
    }
  });
  return neighborIds.size;
}

export function mergeUniverseActivation(
  current: UniverseWorkingSet,
  activation: UniverseActivation,
  budget: { nodes: number; edges: number },
  now = Date.now(),
  options: MergeUniverseActivationOptions = {},
): UniverseWorkingSet {
  const epoch = activation.epoch ?? current.epoch;
  if (epoch !== current.epoch) return current;
  const nodesByKey = new Map(
    current.nodes.map((node) => [universeNodeKey(node.kind, node.id, node.source_id), node]),
  );
  const addedRootKeys = new Set<string>();
  for (const node of activation.nodes) {
    const sourceId = node.source_id || "";
    const key = universeNodeKey(node.kind, node.id, sourceId);
    const existing = nodesByKey.get(key);
    nodesByKey.set(key, {
      ...existing,
      ...node,
      source_id: sourceId,
      touched_at: now,
      root: existing?.root ?? Boolean(options.roots),
    });
    if (existing?.root || options.roots) addedRootKeys.add(key);
  }
  const relationMap = new Map<string, UniverseRelation>();
  current.relations.forEach((relation) => relationMap.set(relationKey(relation), relation));
  activation.relations.forEach((relation) => relationMap.set(relationKey(relation), relation));
  const committedKeys = new Set(
    current.nodes.map((node) => universeNodeKey(node.kind, node.id, node.source_id)),
  );
  addedRootKeys.forEach((key) => committedKeys.add(key));
  return bounded(
    {
      ...current,
      epoch,
      nodes: [...nodesByKey.values()],
      relations: [...relationMap.values()],
      root_keys: [...new Set([...current.root_keys, ...addedRootKeys])],
    },
    budget,
    committedKeys,
  );
}
