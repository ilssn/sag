import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./knowledge-universe.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("knowledge universe production interaction policy", () => {
  it("separates resident browse capacity from the smaller render budget", () => {
    expect(source).toContain("effectiveUniverseBundleWindow(viewPreferences, mobile)");
    expect(source).toContain("bundleWindow.visibleEventBundles");
    expect(source).toContain("bundleWindow.cachedEventBundles");
    expect(source).toContain("effectiveUniverseBudget(policyBudget)");
    expect(source).toContain("UNIVERSE_RESIDENT_BUDGET.mobile");
    expect(source).toContain("UNIVERSE_RESIDENT_BUDGET.desktop");
    expect(source).toContain("residentBudgetRef.current = residentBudget");
    expect(source).toContain("data-universe-resident-node-budget={residentBudget.nodes}");
    expect(source).toContain("const EVENT_ENTITY_PROJECTION_LIMIT = 8");
    expect(source).toContain("const ENTITY_EXPANSION_EVENT_LIMIT = 4");
  });

  it("places the active event at the centre and older bundles in stable side lanes", () => {
    const placement = sourceBetween(
      "function stableTimelineWindowEventOffset(",
      "function timelineProjectionBundleIds(",
    );
    expect(placement).toContain("const age = Math.max(0, total - index - 1)");
    expect(placement).toContain("x: 0");
    expect(placement).toContain(":timeline-side");
    expect(placement).toContain("side * distance");
    expect(source).toContain("timelineEventPlacementByKey");
    expect(source).toContain("stableTimelineWindowEventOffset(");
  });

  it("keeps concrete-node clicks presentation-only", () => {
    const handler = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const clearSelection = React.useCallback(",
    );
    expect(handler).toContain("nextUniverseLockedNodeId(");
    expect(handler).toContain("graphRef.current?.lockNode(nextLockedId)");
    expect(handler).toContain("graphRef.current?.unlockNode()");
    expect(handler).not.toContain("expandNode(");
    expect(handler).not.toContain("loadSourceTimelinePage(");
    expect(handler).not.toContain("api.");
  });

  it("blocks timeline paging while a node is locked", () => {
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(intent).toContain("if (lockedKeyRef.current)");
    expect(intent).toContain('t("timeline.unlockToContinue")');
    expect(loader).toContain('lockedKeyRef.current && cause !== "source-entry"');
    expect(source).toContain("timelineAbortRef.current?.abort()");
  });

  it("keeps expansion behind the explicit inspector action", () => {
    expect(source).toContain("onClick={() => void expandNode(inspectorNode)}");
  });

  it("keeps one source session with cache, visible window and working set", () => {
    const commit = sourceBetween(
      "const commitWorkingSet = React.useCallback(",
      "const commitTimelineWindow = React.useCallback(",
    );
    const activation = sourceBetween(
      "const activateSource = React.useCallback(",
      "React.useEffect(() => {\n    const onSourceFocus",
    );
    expect(commit).toContain("session.working = next");
    expect(activation).toContain("const session = emptySourceBrowseSession(");
    expect(activation).toContain("bundleWindow.visibleEventBundles");
    expect(activation).toContain("bundleWindow.cachedEventBundles");
    expect(activation).toContain("sourceSessionRef.current = session");
    expect(activation).toContain("setTimelineWindow(session.timeline.window)");
    expect(source).not.toContain("sourceSessionsRef");
    expect(source).not.toContain("sourceTimelinePagesRef");
  });

  it("rejects delayed timeline responses after the active source session changes", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(loader).toContain("sourceSessionRef.current !== session");
    expect(loader).toContain("page.epoch !== epochRef.current");
    expect(loader).toContain("controller.signal.aborted");
  });

  it("reports bounded, semantically honest timeline progress", () => {
    expect(source).toContain("queriedUniverseTimelineEventCount(eventState.window)");
    expect(source).toContain('residentNodes.filter((node) => node.kind === "entity").length');
    expect(source).not.toContain("seenEventIds: Set<string>");
    expect(source).not.toContain("seenEntityIds: Set<string>");
  });

  it("separates server EOF from the user reaching the cached tail", () => {
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    expect(source).toContain("state.networkExhausted = true");
    expect(source).toContain("markUniverseTimelineNetworkExhausted(nextWindow)");
    expect(intent).toContain("current.activeIndex >= current.cacheBundleIds.length - 1");
    expect(intent).toContain("session.timeline.networkExhausted");
    expect(intent).toContain('return "complete"');
  });

  it("prefetches only at a bounded low-water mark with safe FIFO capacity", () => {
    const prefetch = sourceBetween(
      "if (!shouldPrefetchUniverseTimelineWindow(",
      "const timelineJourney = React.useMemo<UniverseTimelineJourney>",
    );
    expect(prefetch).toContain("nextPageSize");
    expect(prefetch).toContain("bundleWindow.cachedEventBundles");
    expect(source).toContain('timelineWindow?.phase !== "idle"');
    expect(prefetch).toContain('loadSourceTimelinePage(session.sourceId, "prefetch")');
  });

  it("keeps normal API page size independent from the visible slider", () => {
    const pageSizing = sourceBetween(
      "const pageBundleLimit = universeTimelinePageBundleLimit(",
      "const evictionBoundary =",
    );
    expect(pageSizing).toContain("manifest.policy.timeline_event_page_size");
    expect(pageSizing).toContain("residentBudgetRef.current");
    expect(pageSizing).not.toContain("bundleWindow.visibleEventBundles");
    const prefetchSizing = sourceBetween(
      "const nextPageSize = universeTimelinePageBundleLimit(",
      "if (!shouldPrefetchUniverseTimelineWindow(",
    );
    expect(prefetchSizing).toContain("manifest?.policy.timeline_event_page_size ?? 6");
    expect(prefetchSizing).toContain("residentBudget");
    expect(prefetchSizing).not.toContain("bundleWindow.visibleEventBundles");
  });

  it("reconfigures an idle window without moving the active bundle or dropping cached future", () => {
    const reconfiguration = sourceBetween(
      "const next = current.phase === \"transitioning\"",
      "const activateSource = React.useCallback(",
    );
    expect(source).toContain('current.phase === "transitioning"');
    expect(reconfiguration).toContain("bundleWindow.visibleEventBundles");
    expect(reconfiguration).toContain("bundleWindow.cachedEventBundles");
    expect(reconfiguration).toContain("next.visibleBundleIds");
    expect(reconfiguration).toContain("timelineRetentionBundleIds(");
    expect(source).not.toContain("const selectedIds = current.cacheBundleIds.slice(start)");
  });

  it("retains every cached bundle but only support bundles for the visible slice", () => {
    const retention = sourceBetween(
      "function timelineRetentionBundleIds(",
      "function universeBundleWindowProtection(",
    );
    expect(retention).toContain("...timelineBundleIds");
    expect(retention).toContain("...timelineProjectionBundleIds(");
    expect(retention).toContain("visibleTimelineBundleIds");
  });

  it("physically releases off-window support on every visible-window advance", () => {
    const retentionEffect = sourceBetween(
      "const current = session.timeline.window;\n    const next = current.phase",
      "const activateSource = React.useCallback(",
    );
    expect(retentionEffect).toContain('current.phase === "transitioning"');
    expect(retentionEffect).toContain("if (next !== current)");
    expect(retentionEffect).toContain("const bundleOrderChanged =");
    expect(retentionEffect).toContain("if (!bundleOrderChanged) return");
    expect(retentionEffect.indexOf('session.timeline.pausedReason === "capacity"'))
      .toBeGreaterThan(retentionEffect.indexOf("if (!bundleOrderChanged) return"));
    expect(retentionEffect.indexOf("commitWorkingSet(retained)"))
      .toBeGreaterThan(retentionEffect.indexOf("if (!bundleOrderChanged) return"));
  });

  it("protects timeline cursor integrity during page and explicit expansion admission", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    expect(loader).toContain("protectedUniverseTimelineBundleIds(");
    expect(loader).toContain("state.window");
    expect(loader).toContain("evictionBoundary");
    expect(loader).toContain("applyUniverseTimelineBundleEvictions(");
    expect(loader).toContain("admission.evictedBundleIds");
    expect(loader).toContain("evictedAcknowledgedBundle");
    expect(loader).toContain("if (!synchronizedWindow || evictedAcknowledgedBundle)");
    expect(loader.indexOf("applyUniverseTimelineBundleEvictions("))
      .toBeLessThan(loader.indexOf("state.snapshotId = page.snapshot_id"));
    expect(expansion).toContain("browseSession.timeline.window.cacheBundleIds");
    expect(expansion).not.toContain("browseSession.timeline.window.visibleBundleIds");
  });

  it("reports first-page EOF as complete and exposes capacity pauses", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const terminalHint = loader.indexOf('nextWindow.phase === "complete"');
    const readyHint = loader.indexOf('t("timeline.windowReady"');
    expect(terminalHint).toBeGreaterThanOrEqual(0);
    expect(readyHint).toBeGreaterThan(terminalHint);
    expect(loader).toContain('t("timeline.explorationComplete"');
    expect(loader).toContain('state.pausedReason === "capacity"');
    expect(loader).toContain('t("timeline.capacityPaused"');
    expect(source).toContain("activeIndex < cacheLength - 1 || !networkExhausted");
    expect(source).toContain("current.activeIndex >= current.cacheBundleIds.length - 1");
  });

  it("recovers a capacity-paused tail through single-bundle cursor-safe journeys", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    expect(loader).toContain('cause === "journey"');
    expect(loader).toContain('state.pausedReason === "capacity"');
    expect(loader).toContain("&& atCacheTail");
    expect(loader).toContain("universeTimelinePageBundleLimit(");
    expect(loader).toContain("capacityRecovery");
    expect(loader).toContain('? "active-bundle"');
    expect(loader).toContain('|| (capacityRecovery && !admission.done)');
    const recoveryLoad = intent.indexOf(
      "const loadResult = await loadSourceTimelinePage(",
    );
    expect(recoveryLoad).toBeGreaterThanOrEqual(0);
    expect(recoveryLoad).toBeLessThan(intent.indexOf('t("timeline.capacityPaused"'));

    const recoveryCommit = sourceBetween(
      "let nextWindow = appendUniverseTimelineBundles(",
      "const retainedIds = timelineRetentionBundleIds(",
    );
    expect(source).toContain(
      'type SourceTimelineLoadResult = "blocked" | "loaded" | "advanced"',
    );
    expect(recoveryCommit).toContain(
      'advanceUniverseTimelineWindow(nextWindow, "next")',
    );
    expect(recoveryCommit).toContain('loadResult = "advanced"');
    expect(recoveryCommit).toContain('cause: "journey"');
    expect(recoveryCommit.indexOf("timelineJourneyCommitRef.current ="))
      .toBeLessThan(recoveryCommit.indexOf("commitTimelineWindow(session, nextWindow)"));
    expect(
      recoveryCommit.match(/commitTimelineWindow\(session, nextWindow\)/g),
    ).toHaveLength(1);
    expect(loader).toContain('loadResult !== "advanced"');

    const advancedHandler = sourceBetween(
      'if (loadResult === "advanced") {',
      "if (\n          current.activeIndex >= current.cacheBundleIds.length - 1",
    );
    expect(advancedHandler).toContain("scheduleTimelineSettle(session, current)");
    expect(advancedHandler).toContain('return "advanced"');
    expect(advancedHandler).not.toContain("advanceUniverseTimelineWindow(");
  });

  it("keeps active timeline bundles out of generic node-level budget trimming", () => {
    const budgetEffect = sourceBetween(
      "const current = workingRef.current;\n    const session = sourceSessionRef.current;\n    if (session) {",
      "const resetScene = React.useCallback(",
    );
    expect(budgetEffect).toContain("refreshLoadProgress()");
    expect(budgetEffect.indexOf("return;")).toBeLessThan(
      budgetEffect.indexOf("trimUniverseWorkingSet("),
    );
  });

  it("settles cached transitions and keys scene motion to visible bundle identity", () => {
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    expect(source).toContain("scheduleTimelineSettle(session, next)");
    expect(source).toContain("settleUniverseTimelineWindow(next)");
    expect(source).toContain("visibleTimelineBundleIds.join(\"|\")");
    expect(source).toContain("windowRevision: sceneWindowRevision");
    expect(source).toContain("timelineJourneyCommitRef");
    expect(source).toContain("windowChangeCause");
    expect(source).toContain('? "journey"\n      : "synchronization"');
    expect(intent.indexOf("timelineJourneyCommitRef.current ="))
      .toBeLessThan(intent.indexOf("commitTimelineWindow(session, next)"));
  });

  it("projects visible and prioritized support bundles through the scene budget", () => {
    expect(source).toContain("timelineProjectionBundleIds(");
    expect(source).toContain("projectUniverseBundleWindowWithinBudget(");
    expect(source).toContain("visibleTimelineBundleIds");
    expect(source).toContain("timelineSupportBundleIds");
    expect(source).toContain("budget,");
    expect(source).toContain("retainUniverseWorkingSetBundles(");
    expect(source).toContain("universeBundleWindowProtection(");
    expect(source).toContain("protectedRelationKeys: windowProtection.relationKeys");
  });

  it("uses resident admission only for browse and keeps card flags out of graph data", () => {
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const graph = sourceBetween(
      "const graphData = React.useMemo(() => {",
      "const selectedNode = React.useMemo(",
    );
    expect(expansion).toContain(
      "browseSession ? residentBudgetRef.current : budgetRef.current",
    );
    expect(loader).toContain("residentBudgetRef.current");
    expect(graph).toContain("projectedEntityCategories");
    expect(graph).toContain("projectUniverseWorkingSet(");
    expect(graph.indexOf("projectUniverseBundleWindowWithinBudget("))
      .toBeLessThan(graph.indexOf("projectUniverseWorkingSet("));
    expect(graph).not.toContain("showEventCards");
    expect(graph).not.toContain("showEntityCards");
    expect(graph).not.toContain("viewPreferences,");
  });

  it("unlocks and releases pins when category projection hides the selected node", () => {
    const guard = sourceBetween(
      "const visibleNodeIds = new Set(graphData.nodes.map((node) => node.id));",
      "const handleSceneHover = React.useCallback(",
    );
    expect(guard).toContain("selectedMissing");
    expect(guard).toContain("lockedMissing");
    expect(guard).toContain("!visibleNodeIds.has(lockedKey)");
    expect(guard).toContain("clearSelection()");
    expect(guard).toContain("lockedKey, selectedKey");
  });

  it("routes timeline snapshot changes through the singular invalidation path", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(loader).toContain('reason.code === "snapshot_changed"');
    expect(loader).toContain("invalidateSourceSnapshot(sourceId, epoch)");
    expect(source).toContain("expansionSnapshotsRef.current.clear()");
    expect(source).toContain("cursorsRef.current.clear()");
    expect(source).toContain("expandedAnchorsRef.current.clear()");
  });

  it("automatically reloads one fresh root page after snapshot invalidation", () => {
    const invalidation = sourceBetween(
      "const invalidateSourceSnapshot = React.useCallback(",
      "React.useEffect(() => {\n    const onActivate",
    );
    expect(invalidation).toContain("snapshotReloadAttemptsRef.current");
    expect(invalidation).toContain("if (reloadAttempt > 1)");
    expect(invalidation).toContain('loader(sourceId, "source-entry")');
    expect(invalidation).toContain('result === "loaded" || result === "advanced"');
    expect(invalidation).toContain("sourceSessionRef.current !== refreshedSession");
    expect(invalidation).toContain('t("timeline.snapshotReloading")');
    expect(invalidation).toContain('t("timeline.snapshotReset")');
  });

  it("seeds explicit event exploration from each timeline neighbor cursor", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(loader).toContain("bundle.neighbor_page.next_cursor");
    expect(loader).toContain("cursorsRef.current.set(eventKey");
    expect(loader).toContain("expandedAnchorsRef.current.add(eventKey)");
  });

  it("pins and releases complete one-hop networks, including factual edges", () => {
    const click = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const clearSelection = React.useCallback(",
    );
    expect(source).toContain("function universeLockNetwork(");
    expect(source).toContain("relationKeys.add(universeRelationKey(relation))");
    expect(click).toContain("updatePinnedNetwork(network.nodeKeys, network.relationKeys)");
    expect(click).toContain("updatePinnedNetwork([])");
  });

  it("binds expansion cache identity to revision and snapshot", () => {
    const cacheKey = sourceBetween(
      "function universeExpansionCacheKey(",
      "function waitForAbortableDelay(",
    );
    expect(cacheKey).toContain("sourceRevision");
    expect(cacheKey).toContain("snapshotId");
    expect(source).toContain("snapshot_id: snapshot?.snapshotId ?? null");
    expect(source).toContain("admitUniverseExpansionPage(");
  });

  it("ignores stale expansion errors after the source session changes", () => {
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    expect(expansion).toContain("const requestSession = sourceSessionRef.current");
    expect(expansion).toContain("controller.signal.aborted");
    expect(expansion).toContain("requestEpoch !== epochRef.current");
    expect(expansion).toContain("sourceSessionRef.current !== requestSession");
    expect(expansion.indexOf("sourceSessionRef.current !== requestSession"))
      .toBeLessThan(expansion.indexOf("invalidateSourceSnapshot(exactNode.sourceId"));
  });

  it("reopens exhausted anchors after their resident facts are evicted", () => {
    const pruning = sourceBetween(
      "const pruneExpansionState = React.useCallback(",
      "React.useEffect(() => {",
    );
    expect(pruning).toContain("universeAnchorProgress(");
    expect(pruning).toContain("< node.related_count");
    expect(source).toContain("residentProgress >= exactNode.relatedCount");
    expect(source).toContain("committedCount < totalCount");
  });

  it("exposes touch controls and the same scene journey used by wheel and keyboard", () => {
    expect(source).toContain("timelineJourney={timelineJourney}");
    expect(source).toContain("onTimelineIntent={handleTimelineIntent}");
    expect(source).toContain('graphRef.current?.moveTimeline("previous")');
    expect(source).toContain('graphRef.current?.moveTimeline("next")');
    expect(source).toContain('data-universe-timeline-controls="true"');
  });

  it("keeps WebGL fallback, budget lock release and manifest invalidation", () => {
    expect(source).toContain("onUnavailable={handleSceneUnavailable}");
    expect(source).toContain("webglAvailable === false");
    expect(source).toContain("next.nodes.length > budget.nodes");
    expect(source).toContain("setUniversePinnedNetwork(current, [], [])");
    expect(source).toContain("manifestVersionRef.current === manifest.version");
    expect(source).toContain("resetScene(epochRef.current + 1)");
  });
});
