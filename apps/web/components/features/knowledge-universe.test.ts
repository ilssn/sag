import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  advanceUniverseTimelineWindow,
  settleUniverseTimelineWindow,
  type UniverseTimelineWindowState,
} from "../../lib/universe-timeline-window";

const componentSource = readFileSync(
  new URL("./knowledge-universe.tsx", import.meta.url),
  "utf8",
);
const modelSource = readFileSync(
  new URL("./knowledge-universe-model.ts", import.meta.url),
  "utf8",
);
const overlaySource = readFileSync(
  new URL("./knowledge-universe-overlays.tsx", import.meta.url),
  "utf8",
);
const source = `${modelSource}\n${overlaySource}\n${componentSource}`;
const miniWorkspaceSource = readFileSync(
  new URL("./pet-mini-workspace.tsx", import.meta.url),
  "utf8",
);
const petSource = readFileSync(
  new URL("./pet.tsx", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("./app-shell.tsx", import.meta.url),
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

  it("gives timeline events and their local entities a wider immersive stage", () => {
    expect(source).toContain("export const TIMELINE_EVENT_LATERAL_SPREAD");
    expect(source).toContain("export const LOCAL_ENTITY_SPREAD_MIN");
    expect(source).toContain("export const LOCAL_ENTITY_SPREAD_RANGE");
  });

  it("puts every timeline event on the temporal axis, with no mode to opt out of", () => {
    expect(source).toContain("timelineEventPlacementByKey");
    expect(source).toContain("projectUniverseTemporalAxis(");
    expect(source).toContain(
      "temporalProjection.normalizedOffset.z * temporalAxisDepth",
    );
    // Depth is the layout, not a presentation mode that can be toggled off or
    // snapped back to a flat plane.
    expect(source).not.toContain("displayModeState");
    expect(source).not.toContain("universe-display-mode");
    // Expansion-discovered events are placed but carry no temporal projection,
    // so the deterministic spiral stays as their fallback.
    expect(source).toContain("stableRootEventOffset(");
    // Presence along the axis (scale/opacity) is the camera's story, computed
    // per frame by the scene from flight depth — never baked statically into a
    // node by absolute age, which would leave a reached package dim and small.
    expect(source).not.toContain("presentationScale:");
    expect(source).not.toContain("presentationCardScale:");
    expect(source).not.toContain("presentationOpacity:");
  });

  it("derives temporal depth from the snapshot's exploration ordinals, not the cached window", () => {
    // An axis built from the visible window would move an event's depth whenever
    // paging changed what surrounds it — the axis would stop being an axis.
    // The ordinal is the backend's snapshot-stable exploration position, so an
    // imported book (every event at one instant) explores in narrative order.
    expect(source).toContain("createUniverseTemporalAxis(browseSession.timeline.totalEvents ?? 0)");
    expect(source).toContain("state.totalEvents = page.total_events");
    expect(source).toContain("temporalOrdinalByBundleId");
    expect(source).toContain("Number.isInteger(workingBundle.ordinal)");
    // Clock time no longer keys the axis anywhere: no histogram, no timestamp
    // lookup, no window-relative rank fallback.
    expect(source).not.toContain("time_buckets");
    expect(source).not.toContain("universeTemporalRankProgress");
    expect(source).not.toContain("temporalTimestampByBundleId");
    // Axis length is events × a fixed per-event slice, so the visible window
    // spans the same depth whatever the source's size — and never rides on the
    // source's visual radius.
    expect(source).toContain("const TEMPORAL_AXIS_UNITS_PER_EVENT =");
    expect(source).toContain("universeTemporalAxisDepth(");
    expect(source).toContain("temporalAxis\n        ? projectUniverseTemporalAxis(");
  });

  it("hands the scene a flight config bound to the browsed source's axis", () => {
    expect(source).toContain(
      "const temporalFlight = !accumulationMode && temporalAxis && browseSessionSourceId",
    );
    expect(source).toContain("unitsPerEvent: TEMPORAL_AXIS_UNITS_PER_EVENT");
    expect(source).toContain("maxDepth: temporalAxisDepth");
    // The window's depth band comes from the same projections that place the
    // nodes, so flight paging can never disagree with the layout.
    expect(source).toContain("windowNearAge * temporalAxisDepth");
    expect(source).toContain("windowFarAge * temporalAxisDepth");
    // Flight config participates in the stable-identity signature: a config
    // change must reach the scene even when nodes and links are unchanged.
    expect(source).toContain("temporalFlight: data.temporalFlight ?? null");
  });

  it("shifts every event one vestibule deeper so arrival is nebula-only", () => {
    // Flight depth 0 is the hero pose in front of the intact galaxy: the first
    // event, the window band and the axis end all sit one vestibule deeper.
    // Retreating to the wall at depth 0 therefore restores the initial state.
    expect(source).toContain("UNIVERSE_TEMPORAL_AXIS_VESTIBULE_UNITS,");
    expect(source).toContain(
      "- UNIVERSE_TEMPORAL_AXIS_VESTIBULE_UNITS,",
    );
    expect(source).toContain(
      "vestibuleDepth: UNIVERSE_TEMPORAL_AXIS_VESTIBULE_UNITS",
    );
    expect(source).toContain(
      "maxDepth: temporalAxisDepth + UNIVERSE_TEMPORAL_AXIS_VESTIBULE_UNITS",
    );
  });

  it("keeps concrete-node clicks presentation-only", () => {
    const handler = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const moveTimelineManually = React.useCallback(",
    );
    expect(handler).toContain("activatePartition(node as Universe3DNode)");
    expect(handler).toContain("lockNodeForReading(concreteNode)");
    expect(handler).toContain("if (lockedKeyRef.current === concreteNode.id)");
    expect(handler).toContain("clearSelection()");
    expect(handler).toContain("dispatchUniverseDetail(");
    expect(source).toContain("graphRef.current?.lockNode(node.id)");
    expect(source).toContain("graphRef.current?.clearSelection()");
    expect(handler).not.toContain("expandNode(");
    expect(handler).not.toContain("loadSourceTimelinePage(");
    expect(handler).not.toContain("api.");
  });

  it("clears a canvas lock without changing graph data or the camera", () => {
    const releaseReadingFocus = sourceBetween(
      "const releaseReadingFocus = React.useCallback(",
      "const retainCurrentExploration = React.useCallback(",
    );
    const clearSelection = sourceBetween(
      "const clearSelection = React.useCallback(",
      "const timelineNavigationForNode = React.useCallback(",
    );
    const handler = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const moveTimelineManually = React.useCallback(",
    );

    expect(releaseReadingFocus).toContain("graphRef.current?.clearSelection()");
    expect(releaseReadingFocus).toContain("setLockedKey(null)");
    expect(releaseReadingFocus).toContain("setSelectedKey(null)");
    expect(clearSelection).toContain("releaseReadingFocus()");
    expect(clearSelection).toContain("dispatchUniverseInteraction()");
    expect(clearSelection).toContain("options?.dismissWorkspace !== false");
    expect(clearSelection).not.toMatch(/focusOverview\(|resetOverview\(|setData\(|loadSourceTimelinePage\(|api\./);
    expect(handler).not.toContain("commitWorkingSet(");
    expect(handler).not.toContain("setUniversePinnedNetwork(");
    expect(clearSelection).not.toContain("commitWorkingSet(");
    expect(clearSelection).not.toContain("setUniversePinnedNetwork(");
  });

  it("releases the reading lock when a question starts or a follow-up result arrives", () => {
    const ask = sourceBetween(
      "const handleAskNode = React.useCallback(",
      "const timelinePlaybackPlan = React.useMemo(",
    );
    const activation = sourceBetween(
      "React.useEffect(() => {\n    const onActivate",
      "const onFocus = (event: Event) =>",
    );

    expect(ask).toContain("setTimelinePlaying(false)");
    expect(ask).toContain("releaseReadingFocus()");
    expect(ask).toContain("dispatchUniverseAsk(node as UniverseConcrete3DNode)");
    expect(ask.indexOf("releaseReadingFocus()"))
      .toBeLessThan(ask.indexOf("dispatchUniverseAsk("));
    expect(activation).toContain('if (origin === "assistant") {');
    expect(activation).toContain("retained.lockedKey = null");
    expect(activation).toContain("retained.selectedKey = null");
    expect(activation).toContain("releaseReadingFocus()");
  });

  it("keeps transient hover inside the scene instead of mounting a second reading panel", () => {
    expect(source).toContain("const handleSceneHover = React.useCallback(() => undefined, [])");
    expect(source).not.toContain("hoveredConcreteKey");
    expect(source).not.toContain("hoveredConcreteNode");
    expect(source).not.toContain("UniverseNodeDetailPanel");
  });

  it("derives hover exploration progress without loading and reserves actions for click lock", () => {
    const graphProjection = sourceBetween(
      "const graphData = React.useMemo",
      "const visibleGraphCounts = React.useMemo",
    );
    const handler = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const moveTimelineManually = React.useCallback(",
    );
    expect(graphProjection).toContain("relatedProgressByKey");
    expect(graphProjection).toContain("relatedProgress,");
    expect(graphProjection).toContain("canExploreMore:");
    expect(handler).toContain("lockNodeForReading(concreteNode)");
    expect(handler).not.toMatch(/expandNode\(|requestExpansion\(|loadSourceTimelinePage\(|api\./);
    expect(source).toContain("onAskNode={handleAskNode}");
    expect(source).toContain("onExploreMore={handleExploreMore}");
  });

  it("uses the mini workspace as the only reading panel with linked event navigation", () => {
    expect(source).not.toContain("<UniverseNodeDetailPanel");
    expect(source).not.toContain('data-universe-detail-panel="true"');
    expect(source).not.toContain('data-universe-inspector="true"');
    expect(source).toContain("timelineNavigationForNode(concreteNode)");
    expect(miniWorkspaceSource).toContain(".universeNode(");
    expect(miniWorkspaceSource).toContain("const openTimelineEvent = React.useCallback(");
    expect(miniWorkspaceSource).toContain("dispatchUniverseFocus(item.kind, item.id, item.source_id, { lock: true })");
    expect(miniWorkspaceSource).toContain('t("detail.previousEvent")');
    expect(miniWorkspaceSource).toContain('t("detail.nextEvent")');
  });

  it("maps multi-turn answers into a cumulative graph and restores the retained timeline", () => {
    const activation = sourceBetween(
      "React.useEffect(() => {\n    const onActivate",
      "const onFocus = (event: Event) =>",
    );
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    expect(source).toContain("interface RetainedExploration");
    expect(source).toContain("captureExplorationView()");
    expect(activation).toContain("retainCurrentExploration()");
    expect(activation).toContain("mergeUniverseWorkingSetActivation(");
    expect(activation).toContain('origin === "assistant" && !firstActivation');
    expect(activation).toContain("contextSession.activationCount += 1");
    expect(expansion).toContain("admitUniverseExpansionPage(");
    expect(expansion).toContain("commitWorkingSet(next)");
    expect(expansion).toContain(
      "browseSession ? residentBudgetRef.current : budgetRef.current",
    );
    expect(source).toContain("restoreRetainedExploration");
    expect(source).toContain("restoreExplorationView(view)");
    expect(source).toContain('data-universe-context-return="true"');
    expect(source).toContain("onClick={dispatchUniverseResume}");
    expect(source).toContain("onBackgroundClick={handleSceneBackgroundClick}");
    expect(petSource).toContain("dispatchUniverseContext({ active, section:");
    expect(petSource).toContain("UNIVERSE_INTERACTION_EVENT, closeForCanvasGesture");
    expect(miniWorkspaceSource).not.toContain("data-explore-context-status");
  });

  it("treats a node detail as a reversible preview and preserves it during wheel travel", () => {
    const click = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const moveTimelineManually = React.useCallback(",
    );
    const gesture = sourceBetween(
      "const handleSceneInteraction = React.useCallback(",
      "const handleSceneBackgroundClick = React.useCallback(",
    );
    const activation = sourceBetween(
      "React.useEffect(() => {\n    const onActivate",
      "const onFocus = (event: Event) =>",
    );
    expect(click).toContain("if (lockedKeyRef.current === concreteNode.id)");
    expect(click).toContain("clearSelection()");
    expect(gesture).toContain("dispatchUniverseInteraction()");
    expect(activation).not.toContain("dispatchUniverseInteraction()");
    expect(petSource).toContain("const [transientDetailPreview, setTransientDetailPreview]");
    expect(petSource).toContain("setTransientDetailPreview(!readUniverseContext().active)");
    expect(petSource).toContain("&& !transientDetailPreview");
    expect(petSource).not.toContain("if (readUniverseContext().active) return");
    expect(petSource).toContain("setTransientDetailPreview(false);\n      setOpen(false);");
    expect(appShellSource).toContain("const revealDetail = () => enterExploreMode();");
    expect(appShellSource).toContain('const revealAsk = () => enterExploreMode("answer");');
  });

  it("keeps autoplay bounded by the existing cached timeline", () => {
    expect(source).toContain("planUniverseTimelinePlayback({");
    expect(source).toContain("hasOlder: timelineJourney.hasNext");
    expect(source).toContain("hasNewer: timelineJourney.hasPrevious");
    expect(source).toContain("graphRef.current?.moveTimeline(timelinePlaybackPlan.sceneDirection)");
    expect(source).toContain("toggleUniverseTimelinePlaybackOrder(current)");
    expect(source).toContain('setTimelinePlaying(false)');
    expect(source).not.toContain("setInterval(() => graphRef.current?.moveTimeline");
  });

  it("exposes locked-card actions and a non-destructive origin control", () => {
    expect(source).toContain("actionLabels={{");
    expect(source).toContain("onExploreMore={handleExploreMore}");
    expect(source).toContain("onAskNode={handleAskNode}");
    expect(source).toContain("onUserInteraction={handleSceneInteraction}");
    expect(source).toContain("const returnToTimelineOrigin = React.useCallback(");
    expect(source).toContain("graphRef.current?.returnToSourceOrigin(sourceId)");
    expect(source).toContain('label={t("controls.origin")}');
  });

  it("provides a source-only left-top back control with a two-stage retreat", () => {
    const summary = sourceBetween(
      '<div className="pointer-events-none absolute left-3 top-3',
      "{(moreHint || error) && (",
    );
    const home = sourceBetween(
      "const returnToUniverseHome = React.useCallback(",
      "const requestSourceBack = React.useCallback(",
    );
    const sourceBack = sourceBetween(
      "const requestSourceBack = React.useCallback(",
      "React.useEffect(() => {\n    const visibleNodeIds",
    );

    expect(summary).toContain('data-universe-home-control="true"');
    expect(summary).toContain("{showReturnHomeControl && (");
    expect(summary).toContain('aria-label={t("controls.home")}');
    expect(summary).toContain('title={t("controls.homeHint")}');
    expect(summary).toContain("<ChevronLeft");
    expect(summary).not.toContain("<Orbit");
    expect(summary).toContain("var(--universe-source-accent)");
    expect(summary).not.toContain("<House");
    expect(summary).toContain("onClick={requestSourceBack}");
    expect(summary).toContain("pointer-events-auto");
    expect(sourceBack).toContain("graphRef.current?.returnToSourceOrigin(sourceId)");
    expect(sourceBack).toContain('?? "already-at-origin"');
    expect(sourceBack).toContain(
      'if (result === "already-at-origin") returnToUniverseHome()',
    );
    expect(sourceBack.indexOf("returnToSourceOrigin(sourceId)"))
      .toBeLessThan(sourceBack.indexOf("returnToUniverseHome()"));
    expect(home).toContain("resetScene(epochRef.current + 1)");
    expect(source).toContain("viewportSourceRef.current = null");
    expect(source).toContain("setViewportSourceId(null)");
    expect(source).toContain("const showReturnHomeControl = Boolean(browseSessionSourceId)");
    expect(source).toContain("onBackRequest={requestSourceBack}");
  });

  it("routes the active source accent through shell progress and entity affordances", () => {
    expect(source).toContain("universeSourceAccent(activeSourceId, darkTheme)");
    expect(source).toContain('"--universe-source-accent": activeSourceAccent');
    expect(source).toContain('backgroundColor: "var(--universe-source-accent)"');
    expect(source).toContain('data-tone={tone}');
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
    expect(source).toContain("timelineRequestRef.current?.controller.abort()");
  });

  it("keeps expansion behind the explicit detail action", () => {
    expect(source).toContain("onExploreMore={handleExploreMore}");
    expect(source).toContain("void expandNode(node as UniverseConcrete3DNode)");
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
    expect(source).toContain("const networkExhausted = !admission.deque.hasOlder");
    expect(source).toContain("state.deque = dequeAdmission.deque");
    expect(intent).toContain("session.timeline.deque?.hasOlder");
    expect(intent).toContain("markUniverseTimelineNetworkExhausted(current)");
    expect(intent).toContain('return "complete"');
  });

  it("prefetches one safe adjacent page from bidirectional watermarks", () => {
    const prefetch = sourceBetween(
      "const plan = planUniverseTimelinePrefetch({",
      "const timelineJourney = React.useMemo<UniverseTimelineJourney>",
    );
    expect(prefetch).toContain("nextPageSize");
    expect(prefetch).toContain("hasOlder: session.timeline.deque.hasOlder");
    expect(prefetch).toContain("hasNewer: session.timeline.deque.hasNewer");
    expect(prefetch).toContain("preferredDirection: session.timeline.preferredDirection");
    expect(source).toContain('timelineWindow?.phase !== "idle"');
    expect(prefetch).toContain('"prefetch",\n      plan.direction');
  });

  it("keeps normal API page size independent from the visible slider", () => {
    const pageSizing = sourceBetween(
      "const pageBundleLimit = state.queryPageSize ?? universeTimelinePageBundleLimit(",
      "const requestCursor =",
    );
    expect(pageSizing).toContain("state.queryPageSize ??");
    expect(pageSizing).toContain("manifest.policy.timeline_event_page_size");
    expect(pageSizing).toContain("residentBudgetRef.current");
    expect(pageSizing).not.toContain("bundleWindow.visibleEventBundles");
    const prefetchSizing = sourceBetween(
      "const nextPageSize = session.timeline.queryPageSize ?? universeTimelinePageBundleLimit(",
      "const plan = planUniverseTimelinePrefetch({",
    );
    expect(prefetchSizing).toContain("session.timeline.queryPageSize ??");
    expect(prefetchSizing).toContain("manifest?.policy.timeline_event_page_size ?? 6");
    expect(prefetchSizing).toContain("residentBudget");
    expect(prefetchSizing).not.toContain("bundleWindow.visibleEventBundles");
  });

  it("reconfigures an idle window without moving the active bundle or dropping cached future", () => {
    const reconfiguration = sourceBetween(
      "if (current.phase === \"transitioning\") return;",
      "const activateSource = React.useCallback(",
    );
    expect(source).toContain('current.phase === "transitioning"');
    expect(reconfiguration).toContain("bundleWindow.visibleEventBundles");
    expect(reconfiguration).toContain("bundleWindow.cachedEventBundles");
    expect(reconfiguration).toContain("resizeUniverseTimelineDeque(");
    expect(reconfiguration).toContain("activeBundleId");
    expect(reconfiguration).toContain("next.cacheBundleIds");
    expect(reconfiguration).toContain("timelineRetentionBundleIds(");
    expect(source).not.toContain("const selectedIds = current.cacheBundleIds.slice(start)");
  });

  it("retains cached bundles and expansion branches owned by resident timeline roots", () => {
    const retention = sourceBetween(
      "function timelineRetentionBundleIds(",
      "function universeBundleWindowProtection(",
    );
    expect(retention).toContain("...timelineBundleIds");
    expect(retention).toContain("anchoredSupportIds");
    expect(retention).toContain("timelineNodeKeys");
    expect(retention).toContain("lineageQualifiedExpansionBundleIds");
  });

  it("projects only the bounded visible window while retaining the larger cache", () => {
    const projection = sourceBetween(
      "function timelineProjectionBundleIds(",
      "function timelineRetentionBundleIds(",
    );
    expect(projection).toContain("visibleTimelineBundleIds");
    expect(projection).toContain("visibleNodeKeys");
    expect(projection).toContain("timelineBundleIds");
    expect(projection).toContain("if (timelineIds.has(id)) return false");
    expect(source).toContain("projectUniverseBundleWindowWithinBudget(");
  });

  it("synchronizes physical retention after a window or cache change", () => {
    const retentionEffect = sourceBetween(
      "if (current.phase === \"transitioning\") return;",
      "const activateSource = React.useCallback(",
    );
    expect(retentionEffect).toContain('current.phase === "transitioning"');
    expect(retentionEffect).toContain("if (next !== current) commitTimelineWindow");
    expect(retentionEffect).toContain("const bundleOrderChanged =");
    expect(retentionEffect).toContain("if (!bundleOrderChanged) return");
    expect(retentionEffect.indexOf('session.timeline.pausedReason === "capacity"'))
      .toBeLessThan(retentionEffect.indexOf("if (!bundleOrderChanged) return"));
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
    expect(loader).toContain("admitUniverseTimelineDequePage(");
    expect(loader).toContain("synchronizeTimelineWindowWithDeque(");
    expect(loader).toContain(
      "const protectedTimelineBundleIds = synchronizedWindow.cacheBundleIds",
    );
    expect(loader).toContain("admission.evictedBundleIds");
    expect(loader).toContain("retainedDequeIds.has(id)");
    expect(loader).not.toContain("protectedCacheIds");
    expect(loader).toContain("!admission.pageAcknowledged");
    expect(loader.indexOf("synchronizeTimelineWindowWithDeque("))
      .toBeLessThan(loader.indexOf("state.snapshotId = page.snapshot_id"));
    expect(expansion).toContain("browseSession.timeline.window.cacheBundleIds");
    expect(expansion).toContain("visibleSupportBundleIds");
  });

  it("reports first-page EOF as complete and exposes capacity pauses", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const terminalHint = loader.indexOf('synchronizedWindow.phase === "complete"');
    const readyHint = loader.indexOf('t("timeline.windowReady"');
    expect(terminalHint).toBeGreaterThanOrEqual(0);
    expect(readyHint).toBeGreaterThan(terminalHint);
    expect(loader).toContain('t("timeline.explorationComplete"');
    expect(loader).toContain('state.pausedReason = "capacity"');
    expect(loader).toContain('t("timeline.capacityPaused"');
    expect(source).toContain("activeIndex < cacheLength - 1 || hasOlder");
    expect(source).toContain("activeIndex > startActiveIndex || hasNewer");
  });

  it("loads and commits one complete time page per explicit journey", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    expect(loader).toContain("direction: UniverseTimelineDirection");
    expect(loader).toContain("admitUniverseTimelineDequePage(");
    expect(loader).toContain("universeTimelinePageBundleLimit(");
    expect(loader).toContain("state.queryPageSize ??= pageBundleLimit");
    expect(intent).toContain(
      "const queryPageSize = session.timeline.queryPageSize ?? universeTimelinePageBundleLimit(",
    );
    expect(intent).toContain("const pageStride = Math.min(");
    expect(intent).toContain("session.timeline.window.visibleLimit");
    expect(intent).toContain('direction === "next" ? "older" : "newer"');
    expect(intent).toContain('"journey",\n          requestDirection');
    expect(intent).toContain("advanceUniverseTimelineWindow(\n        current,\n        direction,\n        pageStride");
    expect(intent).toContain("const completeTerminalPage = localRunway > 0 && !edgeAvailable");
    expect(intent).toContain("localRunway < pageStride && !completeTerminalPage");
    expect(intent.indexOf("timelineJourneyCommitRef.current ="))
      .toBeLessThan(intent.indexOf("commitTimelineWindow(session, next)"));
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
    expect(source).toContain('windowChangeCause: data.windowChangeCause ?? "synchronization"');
    expect(source).toContain("windowDirection: data.windowDirection ?? null");
    expect(source).toContain("timelineJourneyCommitRef.current = null");
    expect(source).toContain('? "journey"\n      : "synchronization"');
    expect(intent.indexOf("timelineJourneyCommitRef.current ="))
      .toBeLessThan(intent.indexOf("commitTimelineWindow(session, next)"));
  });

  it("settles an in-flight page before suspension so re-entry resumes from a reusable window", () => {
    const commitWriter = sourceBetween(
      "const commitTimelineWindow = React.useCallback(",
      "const scheduleTimelineSettle = React.useCallback(",
    );
    const settleBeforeSuspend = sourceBetween(
      "const settleTimelineBeforeSuspend = React.useCallback(",
      "const mobile = dimensions.width < 768;",
    );
    const suspendEffect = sourceBetween(
      "React.useEffect(() => {\n    if (interactive) return;",
      "React.useEffect(() => {\n    if (!viewportLoadProgress) return;",
    );
    const journey = sourceBetween(
      "const timelineJourney = React.useMemo<UniverseTimelineJourney>",
      "const timelineControlsVisible = Boolean(",
    );

    // The shared commit writer updates the authoritative source session and
    // the React window state with the same settled value.
    expect(commitWriter).toContain("session.timeline.window = next");
    expect(commitWriter).toContain("setTimelineWindow(next)");
    expect(settleBeforeSuspend).toContain("const session = sourceSessionRef.current");
    expect(settleBeforeSuspend).toContain(
      "settleUniverseTimelineWindow(session.timeline.window)",
    );
    expect(settleBeforeSuspend).toContain("commitTimelineWindow(");
    expect(settleBeforeSuspend).toContain("timelineJourneyCommitRef.current = null");

    const settleIndex = suspendEffect.indexOf("settleTimelineBeforeSuspend()");
    const clearTimerIndex = suspendEffect.indexOf("clearTimelineSettle()");
    const pauseIndex = suspendEffect.indexOf("graphRef.current?.pause()");
    expect(settleIndex).toBeGreaterThanOrEqual(0);
    expect(clearTimerIndex).toBeGreaterThan(settleIndex);
    expect(pauseIndex).toBeGreaterThan(clearTimerIndex);

    // Re-entry derives its phase from the synchronized React window, so a
    // non-terminal transitioning page resumes as idle and can page again.
    expect(journey).toContain('phase: timelineWindow?.phase ?? "idle"');

    const transitioning: UniverseTimelineWindowState = {
      cacheBundleIds: ["event-1", "event-2", "event-3"],
      activeIndex: 1,
      visibleBundleIds: ["event-2"],
      visitedCount: 2,
      queriedCount: 3,
      networkExhausted: false,
      phase: "transitioning",
      revision: 4,
      visibleLimit: 1,
      cacheLimit: 4,
      cacheStartOffset: 0,
      rewindStartOffset: 0,
    };
    const resumed = settleUniverseTimelineWindow(transitioning);
    expect(resumed.phase).toBe("idle");
    expect(advanceUniverseTimelineWindow(resumed, "next", 1)).toMatchObject({
      activeIndex: 2,
      phase: "transitioning",
    });
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
    expect(source).toContain("visibleSupportBundleIds");
    expect(source).toContain("...visibleSupportBundleIds");
    expect(source).not.toContain("visibleSupportLineageBundleIds");
  });

  it("bounds the configured timeline window by the effective scene budget", () => {
    const sizing = sourceBetween(
      "const configuredBundleWindow = React.useMemo(",
      "const refreshLoadProgress = React.useCallback(",
    );
    expect(sizing).toContain("manifest?.policy.event_entity_limit");
    expect(sizing).toContain("const packageCapacity = Math.min(");
    expect(sizing).toContain("requiredTransitionPackages");
    expect(sizing).toContain("transitionHeadroomPackages");
    expect(sizing).toContain("budget.nodes - transitionHeadroomPackages * nodesPerPackage");
    expect(sizing).toContain("budget.edges - transitionHeadroomPackages * edgesPerPackage");
    expect(sizing).toContain("configuredBundleWindow.visibleEventBundles");
    expect(sizing).toContain("cachedEventBundles: configuredBundleWindow.cachedEventBundles");
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
      "const visibleGraphCounts = React.useMemo(",
    );
    expect(expansion).toContain(
      "browseSession ? residentBudgetRef.current : budgetRef.current",
    );
    expect(loader).toContain("residentBudgetRef.current");
    expect(graph).toContain("projectedEntityCategories");
    expect(graph).toContain("projectUniverseWorkingSet(");
    expect(graph.indexOf("projectUniverseWorkingSet("))
      .toBeLessThan(graph.indexOf("timelineProjectionBundleIds("));
    expect(graph.indexOf("timelineProjectionBundleIds("))
      .toBeLessThan(graph.indexOf("projectUniverseBundleWindowWithinBudget("));
    expect(graph).not.toContain("showEventCards");
    expect(graph).not.toContain("showEntityCards");
    expect(graph).not.toContain("viewPreferences,");
  });

  it("projects and retains only expansion bundles owned by window lineage roots", () => {
    const projection = sourceBetween(
      "function timelineProjectionBundleIds(",
      "function universeBundleWindowProtection(",
    );
    expect(projection).toContain("lineageQualifiedExpansionBundleIds(");
    expect(projection).toContain('bundle?.origin === "expansion"');
    expect(projection).toContain("bundle.lineage_root_key");
    expect(projection).toContain("if (timelineIds.has(id)) return false");
  });

  it("keeps expansion cursors independent from FIFO payload eviction", () => {
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const pruning = sourceBetween(
      "const pruneExpansionState = React.useCallback(",
      "React.useEffect(() => {",
    );
    expect(expansion).toContain("expansionLineageRootKey(");
    expect(expansion).toContain("lineageRootKey");
    expect(expansion).toContain("visibleSupportBundleIds");
    expect(expansion).toContain("protectedBundleIds:");
    expect(expansion).not.toContain("currentAnchorExpansionBundleIds");
    expect(loader).toContain("protectedTimelineBundleIds");
    expect(loader).toContain("...protectedTimelineBundleIds");
    expect(loader).toContain("...visibleSupportBundleIds");
    expect(pruning).not.toContain("cursorsRef.current.set(");
    expect(source).not.toContain("expansionSeedCursorsRef");
  });

  it("never reuses an expansion request whose abort signal has fired", () => {
    const request = sourceBetween(
      "const requestExpansion = React.useCallback(",
      "const expandNode = React.useCallback(",
    );
    expect(request).toContain("pending && !pending.signal.aborted");
    expect(request).toContain("pending.promise");
    expect(request).toContain("{ promise: request, signal }");
  });

  it("derives browse root roles from the visible window instead of cached ownership", () => {
    const graph = sourceBetween(
      "const graphData = React.useMemo(() => {",
      "const visibleGraphCounts = React.useMemo(",
    );
    expect(graph).toContain("const visibleTimelineNodeKeys = new Set(");
    expect(graph).toContain("const isVisualRoot =");
    expect(graph).toContain("if (!timelineBrowseActive) return node.root");
    expect(graph).toContain(
      'root: accumulationMode ? node.kind === "event" : isVisualRoot(node)',
    );
    expect(graph).toContain("timelineSupportBundleIds = timelineProjectionIds.filter");
    expect(graph).toContain("!visibleTimelineSet.has(id)).reverse()");
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

  it("keeps transient hover inside WebGL instead of rerendering the universe controller", () => {
    const hover = sourceBetween(
      "const handleSceneHover = React.useCallback(",
      "React.useEffect(() => {",
    );
    expect(hover).toContain("() => undefined");
    expect(hover).not.toContain("setHoveredConcreteKey");
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
      "const onActivate = (event: Event) => {",
    );
    expect(invalidation).toContain("snapshotReloadAttemptsRef.current");
    expect(invalidation).toContain("if (reloadAttempt > 1)");
    expect(invalidation).toContain('loader(sourceId, "source-entry")');
    expect(invalidation).toContain('result === "loaded"');
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

  it("keeps click lock presentation-only and out of the working-set projection", () => {
    const click = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const moveTimelineManually = React.useCallback(",
    );
    expect(click).toContain("lockNodeForReading(concreteNode)");
    expect(click).toContain("lockedKeyRef.current === concreteNode.id");
    expect(click).toContain("clearSelection()");
    expect(source).toContain("graphRef.current?.clearSelection()");
    expect(click).not.toContain("workingRef.current");
    expect(click).not.toContain("setUniversePinnedNetwork(");
    expect(source).not.toContain("function universeLockNetwork(");
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

  it("keeps terminal expansion state after old resident facts are evicted", () => {
    const pruning = sourceBetween(
      "const pruneExpansionState = React.useCallback(",
      "React.useEffect(() => {",
    );
    expect(pruning).not.toContain("universeAnchorProgress(");
    expect(source).not.toContain("residentProgress >= exactNode.relatedCount");
    expect(source).toContain("expandedAnchorsRef.current.has(anchorKey)");
    expect(source).toContain("!cursorsRef.current.has(key)");
    expect(source).toContain("committedCount < totalCount");
  });

  it("keeps time buttons aligned with the wheel journey", () => {
    expect(source).toContain("timelineJourney={timelineJourney}");
    expect(source).toContain("onTimelineIntent={handleTimelineIntent}");
    expect(source).toContain('onClick={() => moveTimelineManually("previous")}');
    expect(source).toContain('onClick={() => moveTimelineManually("next")}');
    expect(source).toContain('data-universe-timeline-controls="true"');
    // No camera gesture may reach back and rearrange the layout: the axis is not
    // a presentation the camera can restore.
    expect(source).not.toContain("onCameraInteraction");
  });

  it("keeps the time-page controls mounted while page availability changes", () => {
    const visibilityStart = source.indexOf("const timelineControlsVisible = Boolean(");
    expect(visibilityStart).toBeGreaterThanOrEqual(0);
    const visibilityEnd = source.indexOf(");", visibilityStart);
    expect(visibilityEnd).toBeGreaterThan(visibilityStart);
    const visibility = source.slice(visibilityStart, visibilityEnd + 2);

    expect(visibility).toContain("interactive");
    expect(visibility).toContain("browseSessionSourceId");
    expect(visibility).toContain("timelineWindow");
    expect(visibility).not.toContain("activePartition");
    expect(visibility).not.toMatch(/cacheBundleIds|hasNext|hasPrevious|phase|timelineJourney/);

    const controlsMarker = 'data-universe-timeline-controls="true"';
    const markerIndex = source.indexOf(controlsMarker);
    expect(markerIndex).toBeGreaterThanOrEqual(0);

    const controls = source.slice(
      Math.max(0, markerIndex - 600),
      markerIndex + 2_400,
    );

    // A timeline can be temporarily disabled while its first page or a source
    // switch is settling. That state must disable navigation, not unmount the
    // rail and make it appear to have vanished.
    expect(controls).not.toContain("interactive && timelineJourney.enabled");
    expect(controls).toContain("timelineControlsVisible && !contextualWorkspaceActive && (");
    expect(controls).not.toMatch(/timelineJourney\.has(?:Previous|Next)\s*&&\s*\(/);

    expect(controls).toContain('onClick={() => moveTimelineManually("previous")}');
    expect(controls).toContain('onClick={() => moveTimelineManually("next")}');
    expect(controls).toContain("disabled={!timelineJourney.hasPrevious");
    expect(controls).toContain("disabled={!timelineJourney.hasNext");
    expect(controls.match(/timelineJourney\.phase === "loading"/g)).toHaveLength(2);
    expect(controls.match(/timelineJourney\.phase === "transitioning"/g)).toHaveLength(2);
  });

  it("does not let source LOD replace the active browse session", () => {
    const sourceLod = sourceBetween(
      "const handleSourceLod = React.useCallback(",
      "const handleTimelineIntent = React.useCallback(",
    );
    const activeSession = sourceLod.indexOf("sourceSessionRef.current?.sourceId");
    const sourceMismatchGuard = sourceLod.search(
      /(?:sessionSourceId\s*!==\s*sourceId|sourceId\s*!==\s*sessionSourceId)/,
    );
    const partitionWrite = sourceLod.indexOf("setActivePartition(sourceId)");

    expect(activeSession).toBeGreaterThanOrEqual(0);
    expect(sourceMismatchGuard).toBeGreaterThan(activeSession);
    expect(partitionWrite).toBeGreaterThan(sourceMismatchGuard);
    expect(partitionWrite).toBeGreaterThan(activeSession);
  });

  it("uses the browse session as the single timeline data authority", () => {
    const activation = sourceBetween(
      "const activateSource = React.useCallback(",
      "React.useEffect(() => {",
    );
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {",
    );
    const prefetch = sourceBetween(
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
      "const timelineJourney = React.useMemo<UniverseTimelineJourney>",
    );
    const graph = sourceBetween(
      "const graphData = React.useMemo(() => {",
      "const visibleGraphCounts = React.useMemo(",
    );

    expect(activation).toContain('activationOriginRef.current = "browse"');
    expect(activation).toContain('setActivationOrigin("browse")');
    expect(intent).not.toContain("session.sourceId !== activePartition");
    expect(prefetch).not.toContain("session.sourceId !== activePartition");
    expect(graph).toContain("const timelineBrowseActive = Boolean(browseSessionSourceId)");
    expect(graph).not.toContain("sourceSessionRef.current?.sourceId === activePartition");
  });

  it("projects accumulated answers separately from source exploration", () => {
    const graph = sourceBetween(
      "const graphData = React.useMemo(() => {",
      "const visibleGraphCounts = React.useMemo(",
    );

    expect(source).toContain(
      'const sceneStrategy: UniverseSceneStrategy = activationOrigin === "browse"',
    );
    expect(graph).toContain(
      'const accumulationMode = sceneStrategy === "accumulation"',
    );
    expect(graph).toContain(
      "const nodes: Universe3DNode[] = accumulationMode ? []",
    );
    expect(graph).toContain("stableAccumulationEventOffset(key)");
    expect(source).toContain("strategy={sceneStrategy}");
    expect(source).toContain("dispatchUniversePresentation(sceneStrategy)");
  });

  it("keeps WebGL fallback, budget lock release and manifest invalidation", () => {
    expect(source).toContain("onUnavailable={handleSceneUnavailable}");
    expect(source).toContain("webglAvailable === false");
    expect(source).toContain("sceneUnavailableReason");
    expect(source).toContain("setSceneAttempt((current) => current + 1)");
    expect(source).not.toContain("failIfMajorPerformanceCaveat: true");
    expect(source).toContain("next.nodes.length > budget.nodes");
    expect(source).toContain("trimUniverseWorkingSet(\n        current,\n        budget,");
    expect(source).toContain("manifestVersionRef.current === manifest.version");
    expect(source).toContain("resetScene(epochRef.current + 1)");
  });

  it("stages exploration as a cinematic arrival and exposes overview breathing state", () => {
    expect(source).toContain(
      'data-universe-view={viewportSourceId ? "detail" : "overview"}',
    );
    expect(source).toContain("transition-[opacity,transform,filter] duration-700");
    expect(source).toContain("scale-[0.76] opacity-0 blur-[10px]");
  });
});
