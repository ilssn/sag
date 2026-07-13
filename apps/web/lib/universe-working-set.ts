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

export function sourceTimelinePageTargetForLod(
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
  /** Oldest-to-newest admission order. Missing values are derived from `nodes` for compatibility. */
  node_order?: string[];
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
    node_order: [],
  };
}

function relationKey(relation: UniverseRelation) {
  return `${relation.source_id}:${relation.kind}:${relation.from_id}:${relation.to_id}`;
}

function nodeLimit(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizedNodeOrder(value: UniverseWorkingSet) {
  const nodesByKey = new Map(
    value.nodes.map((node) => [universeNodeKey(node.kind, node.id, node.source_id), node]),
  );
  const seen = new Set<string>();
  const order: string[] = [];
  const append = (key: string) => {
    if (seen.has(key) || !nodesByKey.has(key)) return;
    seen.add(key);
    order.push(key);
  };
  value.node_order?.forEach(append);
  value.nodes.forEach((node) => append(universeNodeKey(node.kind, node.id, node.source_id)));
  return order;
}

function dedupeRelations(relations: UniverseRelation[]) {
  const relationMap = new Map<string, UniverseRelation>();
  relations.forEach((relation) => {
    const key = relationKey(relation);
    // Re-insertion records the latest occurrence at the end of the map.
    relationMap.delete(key);
    relationMap.set(key, relation);
  });
  return [...relationMap.values()];
}

function bounded(
  value: UniverseWorkingSet,
  budget: { nodes: number; edges: number },
  protectedKeys: Iterable<string>,
): UniverseWorkingSet {
  const nodesByKey = new Map(
    value.nodes.map((node) => [universeNodeKey(node.kind, node.id, node.source_id), node]),
  );
  const order = normalizedNodeOrder(value);
  const maximumNodes = nodeLimit(budget.nodes);
  const protectedOrder = [...new Set(protectedKeys)].filter((key) => nodesByKey.has(key));
  const protectedSet = new Set(protectedOrder);
  const keptKeys = new Set(order);

  // FIFO eviction: walk from the oldest admission and skip only this transaction's protection.
  for (const key of order) {
    if (keptKeys.size <= maximumNodes) break;
    if (!protectedSet.has(key)) keptKeys.delete(key);
  }
  // A batch larger than the whole budget cannot be kept atomically. Preserve its declared
  // protection order deterministically (anchor first, then patch input order).
  if (keptKeys.size > maximumNodes) {
    keptKeys.clear();
    protectedOrder.slice(0, maximumNodes).forEach((key) => keptKeys.add(key));
  }

  const nodeOrder = order.filter((key) => keptKeys.has(key));
  const nodes = nodeOrder
    .map((key) => nodesByKey.get(key))
    .filter((node): node is UniverseWorkingNode => Boolean(node));
  const validRelations = dedupeRelations(value.relations)
    .filter((relation) => {
      const targetKind = relation.kind === "subevent" ? "event" : "entity";
      return keptKeys.has(universeNodeKey("event", relation.from_id, relation.source_id))
        && keptKeys.has(universeNodeKey(targetKind, relation.to_id, relation.source_id));
    });
  const maximumEdges = nodeLimit(budget.edges);
  const relations = maximumEdges === 0 ? [] : validRelations.slice(-maximumEdges);
  return {
    ...value,
    nodes,
    relations,
    root_keys: value.root_keys.filter((key) => keptKeys.has(key)),
    node_order: nodeOrder,
  };
}

export function trimUniverseWorkingSet(
  current: UniverseWorkingSet,
  budget: { nodes: number; edges: number },
  protectedKeys: Iterable<string> = [],
): UniverseWorkingSet {
  return bounded(current, budget, protectedKeys);
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
  const initialOrder = [...nodesByKey.keys()];
  return bounded(
    {
      epoch: activation.epoch ?? 0,
      nodes: [...nodesByKey.values()],
      relations: [...relationMap.values()],
      root_keys: rootKeys,
      node_order: initialOrder,
    },
    budget,
    initialOrder.slice(0, nodeLimit(budget.nodes)),
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
  const nodeOrder = normalizedNodeOrder(current);
  const anchorKey = universeNodeKey(
    patch.anchor.kind,
    patch.anchor.id,
    patch.anchor.source_id,
  );
  const anchor = nodesByKey.get(anchorKey);
  if (!anchor) nodeOrder.push(anchorKey);
  nodesByKey.set(anchorKey, {
    ...anchor,
    ...patch.anchor,
    source_id: patch.anchor.source_id,
    touched_at: now,
    root: anchor?.root ?? true,
    state: "active",
  });
  const protectedOrder = [anchorKey];
  for (const node of patch.nodes) {
    const key = universeNodeKey(node.kind, node.id, node.source_id);
    const existing = nodesByKey.get(key);
    if (!existing) nodeOrder.push(key);
    nodesByKey.set(key, {
      ...existing,
      ...node,
      source_id: node.source_id,
      touched_at: now,
      root: existing?.root ?? false,
    });
    if (!protectedOrder.includes(key)) protectedOrder.push(key);
  }
  return bounded(
    {
      ...current,
      nodes: [...nodesByKey.values()],
      relations: dedupeRelations([...current.relations, ...patch.relations]),
      node_order: nodeOrder,
    },
    budget,
    protectedOrder,
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
  const nodeOrder = normalizedNodeOrder(current);
  const addedRootKeys = new Set<string>();
  const newKeys: string[] = [];
  for (const node of activation.nodes) {
    const sourceId = node.source_id || "";
    const key = universeNodeKey(node.kind, node.id, sourceId);
    const existing = nodesByKey.get(key);
    if (!existing) {
      nodeOrder.push(key);
      newKeys.push(key);
    }
    nodesByKey.set(key, {
      ...existing,
      ...node,
      source_id: sourceId,
      touched_at: now,
      root: existing?.root ?? Boolean(options.roots),
    });
    if (existing?.root || options.roots) addedRootKeys.add(key);
  }
  return bounded(
    {
      ...current,
      epoch,
      nodes: [...nodesByKey.values()],
      relations: dedupeRelations([...current.relations, ...activation.relations]),
      root_keys: [...new Set([...current.root_keys, ...addedRootKeys])],
      node_order: nodeOrder,
    },
    budget,
    newKeys,
  );
}
