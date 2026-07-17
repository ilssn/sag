export interface UniversePreviewNode {
  id: string;
  kind: "event" | "entity";
  sourceId: string;
  active: boolean;
}

export interface UniversePreviewPlan {
  ids: readonly string[];
  eventIds: readonly string[];
  entityIds: readonly string[];
  focused: boolean;
  hiddenRelatedEntityCount: number;
}

export interface UniversePreviewPlanInput {
  /** Nodes arrive in the scene's stable reading order. */
  nodes: readonly UniversePreviewNode[];
  adjacency: ReadonlyMap<string, ReadonlySet<string>>;
  sourceId: string | null;
  /** Accumulation may contain evidence from more than one source. */
  includeAllSources?: boolean;
  focusId: string | null;
  cardsEnabled: boolean;
  eventPreviewCount: number;
  entitySafetyMax: number;
}

function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function uniqueNodes(
  nodes: readonly UniversePreviewNode[],
  sourceId: string | null,
) {
  const result: UniversePreviewNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if ((sourceId && node.sourceId !== sourceId) || seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
  }
  return result;
}

function relatedEntityIds(
  eventIds: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const result = new Set<string>();
  for (const eventId of eventIds) {
    for (const relatedId of adjacency.get(eventId) ?? []) {
      result.add(relatedId);
    }
  }
  return result;
}

/**
 * Resolves the bounded DOM reading aperture.
 *
 * The scene window still owns every event, entity and relation. This plan only
 * decides which nodes receive DOM cards. At rest, event cards are selected
 * first and entity cards are derived from those events. A concrete hover or
 * lock takes over the same aperture with its factual one-hop network instead
 * of adding a second wall of cards.
 */
export function planUniversePreviewCards(
  input: UniversePreviewPlanInput,
): UniversePreviewPlan {
  const empty = {
    ids: [],
    eventIds: [],
    entityIds: [],
    focused: false,
    hiddenRelatedEntityCount: 0,
  } satisfies UniversePreviewPlan;
  const allNodes = uniqueNodes(input.nodes, null);
  const allById = new Map(allNodes.map((node) => [node.id, node]));
  const focusNode = input.focusId ? allById.get(input.focusId) : undefined;
  const focused = Boolean(focusNode);
  const sourceScope = focused
    ? focusNode?.sourceId ?? null
    : input.includeAllSources
      ? null
      : input.sourceId;
  if (!sourceScope && !input.includeAllSources) return empty;
  const nodes = uniqueNodes(allNodes, sourceScope);
  if (!input.cardsEnabled && !focused) return empty;

  const configuredEventLimit = boundedInteger(
    input.eventPreviewCount,
    0,
    nodes.length,
  );
  const eventLimit = focused
    ? Math.max(1, configuredEventLimit)
    : configuredEventLimit;
  if (eventLimit === 0) return empty;

  const networkIds = focused && input.focusId
    ? new Set([input.focusId, ...(input.adjacency.get(input.focusId) ?? [])])
    : null;
  const eligible = nodes.filter((node) => (
    networkIds ? networkIds.has(node.id) : node.active
  ));

  const eventIds: string[] = [];
  if (focusNode?.kind === "event") eventIds.push(focusNode.id);
  for (const node of eligible) {
    if (
      node.kind !== "event"
      || eventIds.includes(node.id)
      || eventIds.length >= eventLimit
    ) continue;
    eventIds.push(node.id);
  }

  const relatedIds = networkIds ?? relatedEntityIds(
    eventIds,
    input.adjacency,
  );
  const entityCandidates: string[] = [];
  if (focusNode?.kind === "entity") entityCandidates.push(focusNode.id);
  for (const node of eligible) {
    if (
      node.kind !== "entity"
      || !relatedIds.has(node.id)
      || entityCandidates.includes(node.id)
    ) continue;
    entityCandidates.push(node.id);
  }

  const entitySafetyLimit = boundedInteger(
    input.entitySafetyMax,
    0,
    nodes.length,
  );
  const entityLimit = focused
    // A concrete hover/lock is a reading request: reveal the complete one-hop
    // network while retaining the global safety ceiling. Capping focus to four
    // entities left highlighted lines without readable endpoints.
    ? entitySafetyLimit
    : Math.min(entitySafetyLimit, eventIds.length * 2);
  const entityIds = entityCandidates.slice(0, entityLimit);

  return {
    ids: [...eventIds, ...entityIds],
    eventIds,
    entityIds,
    focused,
    hiddenRelatedEntityCount: Math.max(
      0,
      entityCandidates.length - entityIds.length,
    ),
  };
}
