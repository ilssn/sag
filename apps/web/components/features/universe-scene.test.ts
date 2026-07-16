import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./universe-scene.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("universe scene production invariants", () => {
  it("keeps search presentation-only and never translates source coordinates", () => {
    expect(source).not.toMatch(
      /SourceTween|sourceTween|sourceTargets|applySourceTargets|updateSourceTween|easeInOutCubic/,
    );

    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    expect(dataCommit).toContain("searchFocusSourceId && !this.lockedId");
    expect(dataCommit).toContain("this.focusSource(searchFocusSourceId)");
    expect(dataCommit).not.toMatch(/sourceHits[\s\S]*?(?:\.x\s*=|\.y\s*=|\.z\s*=)/);
  });

  it("uses a static bounded-cost renderer contract", () => {
    expect(source).toContain(".enableNodeDrag(false)");
    expect(source).toContain(".linkDirectionalParticles(0)");
    expect(source).toContain(".linkWidth(() => this.linkWorldWidth())");
    expect(source).toContain(".linkResolution(3)");
    expect(source).toContain(".linkCurvature(0)");
    expect(source).not.toContain(".onNodeDrag(");
    expect(source).not.toContain(".onNodeDragEnd(");
    expect(source).not.toContain(".refresh(");
  });

  it("bounds large-canvas fill rate and avoids forced label layout on every camera frame", () => {
    const cameraChange = sourceBetween(
      "private handleControlsChange = () =>",
      "private handlePointerMove = (event: PointerEvent)",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    const pixelRatio = sourceBetween(
      "private updatePixelRatio()",
      "private handleResize = () =>",
    );

    expect(source).toContain("const MAX_RENDER_PIXELS_DESKTOP = 2_400_000");
    expect(source).toContain("const MAX_RENDER_PIXELS_MOBILE = 1_100_000");
    expect(pixelRatio).toContain("const areaCap = Math.sqrt(renderPixelBudget / cssPixelArea)");
    expect(pixelRatio).toContain("Math.min(window.devicePixelRatio || 1, qualityCap, areaCap)");
    expect(pixelRatio).toContain("this.host.dataset.universeRenderPixels");
    expect(cameraChange).toContain("this.updateLabels(now)");
    expect(cameraChange).not.toContain("this.updateLabels(now, true)");
    expect(cameraChange).not.toContain("this.armNebulaAnimation(");
    expect(labelLayout.match(/this\.host\.getBoundingClientRect\(\)/g)).toHaveLength(1);
    expect(labelLayout).toContain("this.miniPanelRect(hostRect)");
    expect(labelLayout).toContain("hostRect,");
  });

  it("gives the wheel one meaning per context: flight in a source, zoom elsewhere", () => {
    const cameraStart = sourceBetween(
      "private handleControlsStart = () =>",
      "private handleControlsChange = () =>",
    );
    const cameraChange = sourceBetween(
      "private handleControlsChange = () =>",
      "private handlePointerMove = (event: PointerEvent)",
    );
    const wheel = sourceBetween(
      "private handleTimelineWheel = (event: WheelEvent) =>",
      "private handlePointerDown = (event: PointerEvent) =>",
    );
    const wheelRouting = sourceBetween(
      "private timelineWheelSurface(target: EventTarget | null)",
      "private handleTimelineWheel = (event: WheelEvent) =>",
    );
    const pointer = sourceBetween(
      "private handlePointerDown = (event: PointerEvent) =>",
      "private handleControlsStart = () =>",
    );
    const flight = sourceBetween(
      "private updateTemporalFlight(now: number)",
      "private timelineWheelSurface(target: EventTarget | null)",
    );
    const intent = sourceBetween(
      "async moveTimeline(",
      "private createNodeObject(node: ForceNode)",
    );

    expect(source).toContain("export interface UniverseTimelineJourney");
    expect(source).toContain("windowRevision?: number");
    expect(source).toContain('this.controls.addEventListener("start", this.handleControlsStart)');
    expect(source).toContain('this.controls.addEventListener("change", this.handleControlsChange)');
    // The listener must be able to consume the gesture outright.
    expect(source).toContain('this.host.addEventListener("wheel", this.handleTimelineWheel, {');
    expect(source).toContain("capture: true,");
    expect(source).toContain("passive: false,");
    expect(source).toContain('this.host.removeEventListener("wheel", this.handleTimelineWheel, true)');
    // The 120px hidden-threshold planner is gone for good.
    expect(source).not.toContain("universe-timeline-wheel");
    expect(source).toContain('from "@/lib/universe-temporal-flight"');

    // In a browsed source with an axis the wheel flies; pinch and overview stay
    // native OrbitControls zoom, consumed before the canvas listener ever fires.
    expect(wheel).toContain(
      "const flightActive = this.timelineJourney.enabled && this.flightConfig !== null",
    );
    expect(wheel).toContain("hoveredNode?.kind === \"source\"");
    expect(wheel).toContain("this.callbacks.onSourceWheel?.(hoveredNode.sourceId)");
    expect(wheel).toContain("advanceUniverseSourceExitGate(this.sourceExitGate");
    expect(wheel).toContain('this.sourceNavigationPhase !== "origin"');
    expect(wheel).toContain("if (exit.exitRequested)");
    expect(wheel).toContain("this.callbacks.onBackRequest?.()");
    expect(wheel).toContain("event.ctrlKey || event.metaKey");
    expect(wheel).toContain('if (surface === "label") this.forwardTimelineWheelToCanvas(event)');
    expect(wheel).toContain("event.preventDefault()");
    expect(wheel).toContain("event.stopPropagation()");
    expect(wheel).toContain("applyUniverseTemporalFlightWheel(this.flightState");
    expect(wheel).not.toContain("moveTimeline(");

    expect(wheelRouting).toContain("TIMELINE_WHEEL_LABEL_SELECTOR");
    expect(wheelRouting).toContain("this.labelLayer.contains(label)");
    expect(wheelRouting).toContain('const forwarded = new WheelEvent("wheel"');
    expect(wheelRouting).toContain("this.forwardedTimelineWheelEvents.add(forwarded)");
    expect(wheelRouting).toContain("this.rendererCanvas.dispatchEvent(forwarded)");

    // A grab brakes the flight; the flight moves the camera only through deltas
    // applied to camera and orbit target together, so orbiting composes freely
    // and no pointer-vs-wheel gesture classifier is needed.
    expect(pointer).toContain("brakeUniverseTemporalFlight");
    expect(flight).toContain("camera.position.z -= delta");
    expect(flight).toContain("this.controls.target.z -= delta");
    expect(flight).toContain("planUniverseTemporalFlightFollow(");
    // The camera never waits for data: paging along is fire-and-forget.
    expect(flight).not.toContain("await ");
    expect(source).not.toContain("cameraGesture");
    expect(source).not.toContain("onCameraInteraction");

    expect(source).toContain("this.controls.minDistance = UNIVERSE_CAMERA_MIN_DISTANCE");
    expect(source).toContain("this.controls.maxDistance = UNIVERSE_CAMERA_MAX_DISTANCE");
    expect(source).toContain("this.controls.zoomToCursor = true");
    expect(source).toContain("this.controls.enableZoom = options.interactive");
    expect(cameraStart).toContain(
      "this.appliedFlightDepth > UNIVERSE_FLIGHT_SETTLE_EPSILON",
    );
    expect(cameraStart).toContain("this.lodArmed = true");
    expect(cameraChange).not.toContain("moveTimeline(");

    expect(intent).toContain("await this.callbacks.onTimelineIntent(direction)");
    expect(intent).not.toContain("animateTimelineExit");
    expect(source).not.toContain("private animateTimelineExit(");
    expect(intent).not.toContain("this.timelineJourney.networkExhausted");
    expect(intent).toContain('this.timelineJourney.phase === "complete"');
    expect(intent).toContain('if (!this.timelineJourney.hasNext) return "blocked"');
    expect(intent).not.toContain("restoreTimelineExit");
  });

  it("reports locked timeline attempts without starting a scene transition", () => {
    const intent = sourceBetween(
      "async moveTimeline(",
      "private createNodeObject(node: ForceNode)",
    );
    const lockedAttempt = sourceBetween(
      "if (this.lockedId) {",
      "if (direction === \"next\")",
    );

    expect(lockedAttempt).toContain("await this.callbacks.onTimelineIntent(direction)");
    expect(lockedAttempt).toContain('this.host.dataset.universeTimelineResult = "blocked"');
    expect(lockedAttempt).toContain('return "blocked"');
    expect(lockedAttempt).not.toContain("this.animateTimelineExit");
    expect(intent.indexOf("if (this.lockedId)"))
      .toBeLessThan(intent.indexOf("this.timelineIntentPending = true"));
  });

  it("uses one stable transition for explicit page controls", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );

    expect(source).toContain('kind: "enter" | "shift" | "exit"');
    expect(source).toContain("planUniverseSceneDelta(");
    expect(source).toContain("private pruneRetiringTimelineElements()");
    expect(source).toContain("this.timelineExitSide(node)");
    expect(source).toContain("TIMELINE_EXIT_MIN_MS");
    expect(source).toContain("TIMELINE_ENTRY_MS");
    expect(dataCommit).toContain("const animateTimelineWindow = windowChanged");
    expect(dataCommit).toContain("nextWindowRevision !== this.dataWindowRevision");
    expect(dataCommit).toContain("const timelineMotionFor = (");
    expect(dataCommit).toContain("const timelineMotion = timelineMotionFor(");
    expect(dataCommit).toContain("previousVisual");
    expect(dataCommit).toContain("existing.timelineRetiring = false");
    expect(dataCommit).toContain("node.timelineRetiring = true");
    expect(dataCommit).toContain('windowDirection === "previous"');
    expect(dataCommit).toContain("const timelineTransitionOrigin =");
    // Under flight, pages condense and dissolve where they stand; the birth-at-
    // lookat and fly-out choreography remains only for non-flight transitions.
    expect(dataCommit).toContain("const condenseInPlace = this.flightConfig !== null");
    expect(dataCommit).toContain("const dissolveInPlace = this.flightConfig !== null");
    expect(dataCommit).toContain("? destination.clone()");
    expect(dataCommit).toContain("collapseTarget");
    expect(dataCommit).toContain("if (topologyChanged) {");
    expect(dataCommit).toContain('this.timelineMotionPhase = "entering"');
    expect(source).toContain("const startWindowRevision = this.dataWindowRevision");
    expect(source).toContain("this.dataWindowRevision === startWindowRevision");
    expect(source).toContain("this.dataWindowRevision !== startWindowRevision");
    expect(source).not.toContain('event.key === "PageDown"');
    expect(source).toContain(
      "moveTimeline: (direction) => engineRef.current?.moveTimeline(direction)",
    );
    expect(source).not.toContain("waitForTimelineMotions");
  });

  it("starts every node in a timeline window on one shared batch clock", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const timelineMotion = sourceBetween(
      "const timelineMotionFor = (",
      "entrants.forEach((node) => {",
    );

    expect(dataCommit).toContain("const entryNow = performance.now()");
    expect(timelineMotion).toContain("startedAt: entryNow");
    expect(timelineMotion).not.toContain("timeline-entry-delay");
    expect(timelineMotion).not.toMatch(/startedAt:\s*entryNow\s*\+/);
  });

  it("invalidates a stale intent before applying an independent window change", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const interruptionGuard = sourceBetween(
      "private shouldCancelTimelineIntentForWindowChange(",
      "private syncTimelineDiagnostics()",
    );

    expect(source).toContain('windowChangeCause?: "journey" | "synchronization"');
    expect(dataCommit).toContain('data.windowChangeCause ?? "synchronization"');
    expect(dataCommit).toContain("this.shouldCancelTimelineIntentForWindowChange(");
    expect(dataCommit.indexOf("this.cancelTimelineTransition(true)"))
      .toBeLessThan(dataCommit.indexOf("this.dataWindowRevision = nextWindowRevision"));
    expect(interruptionGuard).toContain('if (cause === "journey") return false');
    expect(interruptionGuard).toContain('this.timelineMotionPhase === "awaiting-result"');
    expect(interruptionGuard).toContain('this.timelineMotionPhase === "awaiting-data"');
  });

  it("settles an entering window before applying same-window synchronization", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );

    expect(dataCommit).toContain('windowChangeCause === "synchronization"');
    expect(dataCommit).toContain('this.timelineMotionPhase === "entering"');
    expect(dataCommit).toContain("this.cancelTimelineTransition(true)");
    expect(dataCommit).toContain(
      'if (this.timelineMotionPhase === "entering" && timelineMovingCount === 0)',
    );
  });

  it("never queues a time change from camera gestures", () => {
    expect(source).not.toContain("queuedTimelineDirection");
    expect(source).not.toContain("drainQueuedTimelineDirection");
    expect(source).not.toContain("timelineWheelDirection");
    expect(source).not.toContain("timelineWheelConsumed");
  });

  it("blocks label and keyboard activation while a timeline transition is busy", () => {
    const diagnostics = sourceBetween(
      "private syncTimelineDiagnostics()",
      "private pruneRetiringTimelineElements()",
    );
    const labelInteraction = sourceBetween(
      "private bindLabelInteraction(",
      "private updateLabels(now: number",
    );
    const keyboard = sourceBetween(
      "private handleKeyDown = (event: KeyboardEvent)",
      "private updatePixelRatio()",
    );
    expect(diagnostics).toContain("label.primary.disabled = busy");
    expect(labelInteraction).toContain("if (this.timelineIsBusy()) return");
    expect(keyboard).toContain('this.timelineIsBusy() && event.key !== "Escape"');
    expect(keyboard).toContain('event.key.startsWith("Arrow")');
  });

  it("routes Escape through reading focus and then the owner's two-stage back action", () => {
    const keyboard = sourceBetween(
      "private handleKeyDown = (event: KeyboardEvent)",
      "private updatePixelRatio()",
    );

    expect(source).toContain("onBackRequest?: () => void");
    expect(keyboard).toContain('if (event.key !== "Escape") return');
    expect(keyboard).toContain("const hadKeyboardFocus = Boolean(this.keyboardFocusedId)");
    expect(keyboard).toContain("const hadReadingFocus = Boolean(this.lockedId || this.selectedId)");
    expect(keyboard).toContain("this.clearKeyboardFocus()");
    expect(keyboard).toContain("if (hadReadingFocus) this.callbacks.onSelectionClear()");
    expect(keyboard).toContain("else if (!hadKeyboardFocus) this.callbacks.onBackRequest?.()");
    expect(keyboard.indexOf("this.callbacks.onSelectionClear()"))
      .toBeLessThan(keyboard.indexOf("this.callbacks.onBackRequest?.()"));
  });

  it("bounds transition ghosts and initializes deferred node objects at their live visual state", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const nodeObject = sourceBetween(
      "private createNodeObject(node: ForceNode)",
      "private pinNode(node: ForceNode)",
    );

    expect(source).toContain('import { UNIVERSE_SCENE_BUDGET } from "@/lib/universe-working-set"');
    expect(dataCommit).toContain("const transitionNodeBudget = Math.min(");
    expect(dataCommit).toContain("const transitionEdgeBudget = Math.min(");
    expect(dataCommit).toContain("remainingGhostNodeCapacity <= 0");
    expect(dataCommit).toContain("remainingGhostLinkCapacity <= 0");
    expect(dataCommit).toContain("this.host.dataset.universeDroppedGhostNodeCount");
    expect(dataCommit).toContain("this.host.dataset.universeDroppedGhostLinkCount");
    expect(nodeObject).toContain("node.object = group");
    expect(nodeObject).toContain("node.renderedEntryOpacity = undefined");
    expect(nodeObject).toContain("this.setObjectOpacity(");
    expect(nodeObject.indexOf("node.object = group"))
      .toBeLessThan(nodeObject.lastIndexOf("this.setObjectOpacity("));
  });

  it("freezes every deterministic position, including the end of entry motion", () => {
    expect(source).toContain("fx: number;");
    expect(source).toContain("fy: number;");
    expect(source).toContain("fz: number;");
    expect(source).toContain("fx: timelineMotion?.from.x ?? entry?.from.x ?? desired.x");
    expect(source).toContain("fy: timelineMotion?.from.y ?? entry?.from.y ?? desired.y");
    expect(source).toContain("fz: timelineMotion?.from.z ?? entry?.from.z ?? desired.z");
    expect(source).toContain("this.freezeNode(node, entry.to)");
    expect(source).toContain("this.syncFrozenNodeCoordinates()");
    expect(source).not.toMatch(/node\.f[xyz]\s*=\s*(?:null|undefined)/);
  });

  it("remembers filtered node destinations in a bounded epoch-local cache", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    expect(source).toContain("const MAX_PLACEMENT_MEMORY = 512");
    expect(dataCommit).toContain("this.placementTargets.clear()");
    expect(dataCommit).toContain("const remembered = this.placementTargets.get(node.id)");
    expect(dataCommit).toContain("this.rememberPlacement(node.id, target)");
    expect(source).toContain("while (this.placementTargets.size > MAX_PLACEMENT_MEMORY)");
    expect(source).toContain("this.host.dataset.universePlacementMemory");
    expect(source).toContain('if (node.kind === "event" || obstacle.kind === "event")');
    expect(source).toContain("const planarClearance = clearance * 0.78");
  });

  it("reveals the unique one-hop event and entity card group for hover and lock", () => {
    const labels = sourceBetween(
      "private rebuildLabels()",
      "private sortLabelsForLayout()",
    );
    const layout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    expect(source).toContain('import { planUniverseFocusCards } from "@/lib/universe-focus-cards"');
    expect(labels).toContain("const focusCardPlan = planUniverseFocusCards(");
    expect(labels).not.toContain("ids: [focusNode.id]");
    expect(labels).toContain("const focusCardIds = new Set(focusCardPlan.ids)");
    expect(labels).toContain("this.host.dataset.universeFocusCardCount");
    expect(labels).toContain("const showEventCards = this.viewPreferences.showEventCards");
    expect(labels).toContain("|| hasConcreteFocus");
    expect(labels).toContain("const showEntityCards = this.viewPreferences.showEntityCards");
    expect(labels).toContain("const cardBudget = universeCardBudget(");
    expect(labels).toContain('&& (node.kind === "event" ? showEventCards : showEntityCards)');
    expect(labels).toContain("const eventLimit = showEventCards");
    expect(labels).toContain("Math.max(cardBudget.events, focusCardPlan.eventCount)");
    expect(labels).toContain("const entityLimit = showEntityCards");
    expect(labels).toContain("Math.max(cardBudget.entities, focusCardPlan.entityCount)");
    expect(labels).toContain("Math.max(cardBudget.total, focusCardPlan.ids.length)");
    expect(labels).toContain("const transientHover =");
    expect(labels).toContain('(node.sceneNode.state === "active" || focusCardIds.has(node.id))');
    expect(labels).toContain("&& (!focusId || focusCardIds.has(node.id))");
    expect(labels).toContain('element.dataset.compact = String(node.kind === "entity" && !locked)');
    expect(labels).toContain('node.kind === "event" && node.id === focusId');
    expect(labels).toContain("total: totalLimit");
    expect(labels).toContain("const eventCandidateLimit = hasConcreteFocus");
    expect(labels).toContain(": Math.min(60, eventLimit * 3)");
    expect(labels).toContain("const entityCandidateLimit = hasConcreteFocus");
    expect(labels).toContain(": Math.min(60, entityLimit * 3)");
    expect(labels).toContain("const totalCandidateLimit = hasConcreteFocus");
    expect(labels).toContain("? focusCardPlan.ids.length");
    expect(labels).toContain("this.labelPlacementBudget = {");
    expect(labels).toContain("this.host.dataset.universeEntityLabelCandidateCount");
    expect(labels).toContain("const existingLabels = new Map(");
    expect(labels).toContain("const nextLabels: SceneLabel[] = []");
    expect(labels).toContain("existingLabels.forEach((label) => label.element.remove())");
    expect(labels).not.toContain("this.labelLayer.replaceChildren()");
    expect(layout).toContain('const expanded = locked || (node.kind === "event"');
    expect(layout).toContain("&& node.id === labelFocusId");
    expect(layout).toContain("const requiredFocusCard =");
    expect(layout).toContain("Boolean(focusCardIds?.has(node.id))");
    expect(layout).toContain("new Set([labelFocusId, ...(labelFocusNeighbors ?? [])])");
    expect(layout).toContain("Math.max(0.72, calculatedOpacity)");
    expect(layout).toContain("const timelineEventCard = label.kind === \"node\"");
    expect(layout).toContain("const distributedCard = requiredFocusCard || timelineEventCard");
    expect(layout).toContain("const clampedCandidates = requiredFocusCard");
    expect(layout).not.toContain("focusGridCandidates");
    expect(layout).toContain("requiredFocusCard || emphasized");
    expect(source).toContain("visibleEntityLabels >= this.labelPlacementBudget.entities");
    expect(source).toContain("this.host.dataset.universeEntityLabelCount");
    expect(labels).toContain('title.removeAttribute("title")');
    expect(labels).toContain('summary.removeAttribute("title")');
    expect(labels).not.toContain("title.title =");
    expect(labels).not.toContain("summary.title =");
    expect(labels).not.toContain('setAttribute("title"');

    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    expect(dataCommit).toContain("&& !link.virtual");
    expect(dataCommit).toContain("this.host.dataset.universeEventStarCount");

    const options = sourceBetween(
      "setOptions(options:",
      "\n  setSelection(selectedId: string | null)",
    );
    expect(options).toContain("const cardPreferencesChanged =");
    expect(options).toContain("if (this.dataReady && (cardPreferencesChanged || labelTextChanged)) this.rebuildLabels()");
    expect(options).not.toContain("graphData(");
  });

  it("shows related exploration progress directly on the hovered event or entity card", () => {
    const labels = sourceBetween(
      "private rebuildLabels()",
      "private sortLabelsForLayout()",
    );
    const labelInteraction = sourceBetween(
      "private bindLabelInteraction(",
      "private updateLabels(now: number",
    );

    // The scene receives already-derived resident progress. Hover must remain
    // presentation-only instead of reaching into React refs or starting I/O.
    expect(source).toContain("relatedProgress?: number");
    expect(source).toContain("canExploreMore?: boolean");
    expect(source).toContain("continueExploring:");
    expect(labels).toContain("sag-universe-node-label__explore");
    expect(labels).toContain("data-universe-node-explore-hint");
    expect(labels).toContain('const exploreHint = document.createElement("span")');
    expect(labels).toContain("node.sceneNode.relatedProgress");
    expect(labels).toContain("node.sceneNode.relatedCount");
    expect(labels).toContain("node.sceneNode.canExploreMore");
    expect(labels).toContain("const hintVisible = node.id === focusId");
    expect(labels).toContain("&& !this.lockedId");
    expect(labels).toContain("exploreHint.hidden = !hintVisible");
    expect(labels).toContain("relatedProgress >= relatedTotal");
    expect(labels).toContain("this.text.explorationProgress(");
    expect(labelInteraction).toContain("this.handleNodeHover(node, true)");
    expect(labelInteraction).toContain("this.callbacks.onNodeClick(node.sceneNode)");
    expect(labelInteraction).not.toMatch(/expandNode|requestExpansion|onTimelineIntent|fetch\(|api\./);
  });

  it("keeps locked-card actions semantic and lets wheel travel unlock without dismissing context", () => {
    const labels = sourceBetween(
      "private rebuildLabels()",
      "private sortLabelsForLayout()",
    );
    const nodeInteraction = sourceBetween(
      "private bindNodeLabelInteraction(",
      "private updateLabels(now: number",
    );
    const wheel = sourceBetween(
      "private handleTimelineWheel = (event: WheelEvent) =>",
      "private handlePointerDown = (event: PointerEvent) =>",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    const safeViewport = sourceBetween(
      "private safeViewportCenter()",
      "private moveCamera(",
    );

    expect(labels).toContain('const element = retained?.element ?? document.createElement("div")');
    expect(labels).toContain('const primary = retained?.primary ?? document.createElement("button")');
    expect(labels).toContain("element.append(primary, actions)");
    expect(labels).not.toContain("primary.append(primary, actions)");
    expect(labels).toContain('button.dataset.universeNodeAction = index === 0 ? "explore-more" : "ask-ai"');
    expect(labels).toContain("actions.hidden = !locked");
    expect(nodeInteraction).toContain("this.callbacks.onExploreMore?.(node.sceneNode)");
    expect(nodeInteraction).toContain("this.callbacks.onAskNode?.(node.sceneNode)");
    expect(wheel).not.toContain("this.callbacks.onUserInteraction?.()");
    expect(wheel).toContain("this.callbacks.onSelectionClear({ dismissWorkspace: false })");
    expect(wheel.indexOf("this.callbacks.onSelectionClear({ dismissWorkspace: false })"))
      .toBeLessThan(wheel.indexOf("applyUniverseTemporalFlightWheel"));
    expect(labelLayout).not.toContain('"[data-universe-detail-panel=\'true\']"');
    expect(safeViewport).not.toContain('"[data-universe-detail-panel=\'true\']"');
  });

  it("dismisses a locked network atomically on blank canvas without reloading or moving it", () => {
    const backgroundClick = sourceBetween(
      ".onBackgroundClick(() => {",
      ".onEngineTick(() => {",
    );
    const clearSelection = sourceBetween(
      "  clearSelection() {",
      "\n  pause() {",
    );

    expect(backgroundClick).toContain("this.lockedId || this.selectedId || this.keyboardFocusedId");
    expect(backgroundClick).toContain("this.callbacks.onSelectionClear()");
    expect(backgroundClick.match(/this\.callbacks\.onSelectionClear\(\)/g)).toHaveLength(1);
    expect(backgroundClick.indexOf("this.lockedId || this.selectedId"))
      .toBeLessThan(backgroundClick.indexOf("this.timelineIsBusy()"));
    expect(backgroundClick).toContain("return;");
    expect(backgroundClick).not.toContain("this.clearKeyboardFocus(");
    expect(backgroundClick).not.toContain("this.rebuildLabels(");
    expect(clearSelection).toContain("this.lockedId = null");
    expect(clearSelection).toContain("this.selectedId = null");
    expect(clearSelection).toContain("this.hoveredId = null");
    expect(clearSelection).toContain("this.keyboardFocusedId = null");
    expect(clearSelection).toContain("this.rebuildLabels()");
    expect(clearSelection).toContain("this.applyHighlight()");
    expect(clearSelection).not.toMatch(/resetOverview\(|focusOverview\(|focusNode\(|setData\(|graphData\(/);
    expect(source).toContain("clearSelection: () => engineRef.current?.clearSelection()");
  });

  it("keeps event stars visible, reachable and clear of default cards", () => {
    const nodeObject = sourceBetween(
      "private createNodeObject(node: ForceNode)",
      "private pinNode(node: ForceNode)",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );

    expect(nodeObject).toContain("map: this.eventTexture");
    expect(nodeObject).toContain("map: this.eventCoreTexture");
    expect(nodeObject).toContain("halo.userData.eventHalo = true");
    expect(nodeObject).toContain("sprite.userData.eventStar = true");
    expect(nodeObject).toContain("sprite.userData.eventCore = true");
    expect(nodeObject).toContain("hit.userData.eventHitArea = true");
    expect(nodeObject).toContain("const coreSize = node.sceneNode.root ? 9.6 : 7.6");
    expect(source).toContain("private nodeProjectionScale(node: ForceNode)");
    expect(source).toContain("? node.sceneNode.root ? 18 : 15");
    expect(source).toContain("? node.sceneNode.root ? 30 : 24");
    expect(source).toContain("projectedPixels > maximumPixels");
    expect(source).toContain("maximumPixels / projectedPixels");
    expect(source).toContain('opacity = node.kind === "event" ? 0.52 : 0.48');
    expect(labelLayout).toContain("const eventStarRects =");
    expect(labelLayout).toContain(
      'const overlapsEventStar = (rect: LabelRect) => label.kind === "node"',
    );
    expect(labelLayout).toContain("!overlapsEventStar(candidate)");
  });

  it("carries optional temporal presentation through mesh, card and link layers", () => {
    const objectVisual = sourceBetween(
      "private setObjectOpacity(node: ForceNode",
      "private nodeProjectionScale(node: ForceNode)",
    );
    const morphScale = sourceBetween(
      "private updateNodeMorphScales(",
      "private updateSourceAuraOpacities()",
    );
    const labels = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    const linkStyle = sourceBetween(
      "private linkVisualStyle(link: ForceLink)",
      "private ensureLinkMaterial(link: ForceLink)",
    );

    expect(source).toContain("presentationScale?: number");
    expect(source).toContain("presentationCardScale?: number");
    expect(source).toContain("presentationOpacity?: number");
    expect(source).toContain("function presentationScale(value: number | undefined)");
    expect(source).toContain("function presentationOpacity(value: number | undefined)");
    expect(source).toMatch(/function presentationScale[\s\S]*?: 1;/);
    expect(source).toMatch(/function presentationOpacity[\s\S]*?: 1;/);

    expect(objectVisual).toContain(
      "const dataScale = currentNodePresentationScale(node)",
    );
    expect(objectVisual).toContain(
      "const dataOpacity = currentNodePresentationOpacity(node)",
    );
    expect(objectVisual).toContain("* dataScale");
    expect(morphScale).toContain("* dataScale");

    // Camera-relative presence must reach every visual layer a package owns:
    // mesh scale and opacity, the DOM card, and both link endpoints. Missing
    // one layer leaves stars dim while their cards glow, or vice versa.
    expect(objectVisual).toContain("const presenceScale = node.temporalPresenceScale ?? 1");
    expect(objectVisual).toContain("* dataOpacity * presenceOpacity");
    expect(objectVisual).toContain("* presenceScale");
    expect(objectVisual).toContain("node.renderedTemporalPresence === presenceKey");
    expect(morphScale).toContain("* (node.temporalPresenceScale ?? 1)");

    expect(labels).toContain("* dataOpacity");
    expect(labels).toContain("node.temporalPresenceOpacity ?? 1");
    expect(labels).toContain(
      "currentNodePresentationCardScale(node)",
    );
    expect(labels).toContain("scaledEventStarRadius");
    expect(linkStyle).toContain(
      "presentationOpacity(link.sceneLink.presentationOpacity)",
    );
    expect(linkStyle).toContain(") * dataOpacity * presenceOpacity");
    expect(linkStyle).toContain("source?.temporalPresenceOpacity ?? 1");
  });

  it("renders every entity as a layered, minimum-size interactive glyph", () => {
    const nodeObject = sourceBetween(
      "private createNodeObject(node: ForceNode)",
      "private pinNode(node: ForceNode)",
    );
    const objectVisual = sourceBetween(
      "private setObjectOpacity(node: ForceNode",
      "private nodeProjectionScale(node: ForceNode)",
    );

    expect(nodeObject).toContain("map: this.entityTexture");
    expect(nodeObject).toContain("map: this.entityCoreTexture");
    expect(nodeObject).toContain("halo.userData.entityHalo = true");
    expect(nodeObject).toContain("sprite.userData.entityCore = true");
    expect(nodeObject).toContain("hit.userData.entityHitArea = true");
    expect(nodeObject).toContain("const coreSize = node.sceneNode.root ? 5.2 : 4");
    expect(nodeObject).toContain("const color = this.entityVisualColor(node.sourceId)");
    expect(nodeObject).toContain("sprite.renderOrder = 2");
    expect(source).toContain(": node.sceneNode.root ? 10 : 8");
    expect(source).toContain("this.host.dataset.universeEntityGlyphCount");
    expect(source).toContain('"--universe-node-accent"');

    // Entering a source makes entity glyphs quieter and finer without ever
    // shrinking their invisible target. Detail treatment belongs to the
    // visual children only; the hit area keeps its generous fixed radius.
    expect(objectVisual).toContain('const entityDetail = node.kind === "entity"');
    expect(objectVisual).toContain("THREE.MathUtils.smoothstep(this.visualDetailMix, 0.42, 0.82)");
    expect(objectVisual).toContain("if (child.userData.hitArea) {");
    expect(objectVisual).toContain("child.visible = entryOpacity * dataOpacity * presenceOpacity > 0.16");
    expect(objectVisual).toContain("return;");
    expect(objectVisual).toContain("const targetOpacity = isHalo");
    expect(objectVisual).toContain("const targetScale = isHalo");
    expect(objectVisual).toContain("detailOpacity = THREE.MathUtils.lerp(1, targetOpacity, entityDetail)");
    expect(objectVisual).toContain("baseVisualScale * THREE.MathUtils.lerp(1, targetScale, entityDetail)");
    expect(objectVisual).toContain("* detailOpacity * dataOpacity * presenceOpacity");
    expect(objectVisual.indexOf("if (child.userData.hitArea)"))
      .toBeLessThan(objectVisual.indexOf("const targetScale = isHalo"));
  });

  it("shows every factual edge by default and only dims context on focus", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const highlight = sourceBetween(
      "private applyHighlight()",
      "private updateObjectOpacities()",
    );
    const linkStyle = sourceBetween(
      "private linkVisualStyle(link: ForceLink)",
      "private ensureLinkMaterial(link: ForceLink)",
    );
    const detach = sourceBetween(
      "private detachSharedNodeResources(node: ForceNode)",
      "private makeClusterForce(): ClusterForce",
    );
    const highlightFlow = sourceBetween(
      "private clearHighlightFlowSprites()",
      "private renderOnce()",
    );
    const renderLoop = sourceBetween(
      "private loop = (now: number) =>",
      "private updateTemporalFlight(now: number)",
    );

    expect(dataCommit).toContain("existing.visible = true");
    expect(dataCommit).toContain("visible: true");
    expect(dataCommit).toContain(
      "this.visibleEdgeIds = new Set(this.links.map((link) => link.id))",
    );
    expect(dataCommit).toContain("link.visible = true");
    expect(highlight).toContain(
      "link.visible && anchorId && (source === anchorId || target === anchorId)",
    );
    expect(highlight).not.toMatch(/link\.visible\s*=/);
    expect(source).not.toContain("edgeDensity");
    expect(source).toContain("new THREE.MeshBasicMaterial(");
    expect(source).toContain("private restingLinkOpacity()");
    expect(source).toContain("private linkWorldWidth()");
    expect(source).toContain("return this.links.length >= 240 ? 0.1 : 0.2");
    expect(source).toContain("THREE.MathUtils.lerp(0.18, 0.055, load)");
    expect(source).toContain("depthTest: true");
    expect(source).toContain("material.depthTest = !link.highlighted");
    expect(source).toContain("link.__lineObj.renderOrder = link.highlighted ? 1 : 0");
    expect(source).toContain("private detachSharedNodeResources(node: ForceNode)");
    expect(source).toContain("candidate.geometry = undefined");
    expect(source).toContain("mapped.map = null");
    expect(detach).toContain("object.removeFromParent()");
    expect(detach).toContain("child.raycast = () => undefined");
    expect(detach.indexOf("object.removeFromParent()"))
      .toBeLessThan(detach.indexOf("candidate.geometry = undefined"));
    expect(detach.indexOf("child.raycast = () => undefined"))
      .toBeLessThan(detach.indexOf("candidate.geometry = undefined"));
    expect(source).toContain("link.lineMaterial = undefined");
    expect(source).toContain(
      "visibleEventLabels + visibleEntityLabels >= this.labelPlacementBudget.total",
    );
    expect(source).toContain("private syncGraphObjectPositions()");
    expect(source).toContain("node.object?.position.set(node.x, node.y, node.z)");
    expect(source).toContain("line.scale.z = start.distanceTo(end)");
    expect(source).toContain("if (hadEntry) {");
    expect(source).toContain("this.updateLinkVisuals()");
    expect(source).toContain("const position = candidate.entry?.to ?? candidate");
    expect(source).toContain("const entryKeepAliveMs = [...nextNodes.values()].reduce");
    expect(source).toContain("this.startLoop(entryKeepAliveMs)");
    expect(linkStyle).toContain("opacity: this.restingLinkOpacity()");
    expect(linkStyle).toContain("if (this.transientHoverFocusId())");
    expect(linkStyle).toContain("this.restingLinkOpacity() * 0.68");
    expect(linkStyle).toContain("if (this.labelFocusId())");
    expect(highlight).toContain("if (anchorId)");
    expect(highlight).toContain("transientHover ? 0.76 : 0.92");
    expect(highlight).toContain("this.syncHighlightFlowSprites()");
    expect(source).toContain("HIGHLIGHT_FLOW_FRAME_MS");
    expect(source).toContain("private updateHighlightFlowSprites(now: number, animate: boolean)");
    expect(highlightFlow).toContain("&& Boolean(this.transientHoverFocusId())");
    expect(highlightFlow).toContain('this.host.dataset.universeHighlightFlowMotion = "animated"');
    expect(highlightFlow).toContain("this.highlightFlowTimer = window.setTimeout(");
    expect(highlightFlow).toContain("this.stopHighlightFlowAnimation()");
    expect(renderLoop).not.toContain("updateHighlightFlowSprites");
    expect(renderLoop).not.toContain("highlightFlowing");
  });

  it("retires the source core while keeping a luminous near-field nebula", () => {
    const nebulaMaterial = sourceBetween(
      "function makeNebulaMaterial(darkTheme: boolean)",
      "class UniverseForceSceneEngine",
    );
    const nebulaAlpha = sourceBetween(
      "private updateNebulaAlphas(force = false)",
      "private nebulaMotionStrength()",
    );
    expect(source).toContain("sprite.userData.sourceCore = true");
    expect(source).toContain("private sourceMarkerDetailFactor(");
    expect(source).toContain("return Math.max(0, 1 - detail)");
    expect(source).toContain("const NEBULA_DETAIL_ALPHA = 1.5");
    expect(source).toContain("const NEBULA_DETAIL_DUST_POINT_SIZE_CSS = 20");
    expect(source).toContain("uDetail: { value: 0 }");
    expect(source).toContain("uDetailAlpha: { value: NEBULA_DETAIL_ALPHA }");
    expect(source).toContain("attribute float aGlow");
    expect(source).toContain("attribute float aSourceIndex");
    expect(source).toContain('geometry.setAttribute("aGlow"');
    expect(source).toContain('geometry.setAttribute("aSourceIndex"');
    expect(source).toContain("material.uniforms.uDetail.value = this.visualDetailMix");
    expect(source).toContain("material.uniforms.uDetailSource.value");
    expect(nebulaMaterial).toContain("float sourceMatch =");
    expect(nebulaMaterial).toContain("float detailBloom = mix(1.0, 1.28, vDetail)");
    expect(nebulaMaterial).toContain("float haze = radial * mix(0.55, 0.95, radial)");
    expect(nebulaMaterial).toContain("if (vGlow > 0.001)");
    expect(nebulaMaterial).toContain("gl_PointSize = min(");
    expect(nebulaMaterial).not.toContain("float diffuseGlow = pow(");
    expect(nebulaAlpha).not.toContain("detailMixBucket");
    expect(nebulaAlpha).not.toContain(
      "particle.sourceId === this.visualSourceId",
    );
    expect(source).toContain("THREE.DynamicDrawUsage");
    expect(source).toContain('this.host.dataset.universeNebulaAlphaMode = "gpu-detail"');
    expect(source).toContain("this.host.dataset.universeNebulaPointSizeCap");
    expect(source).toContain("this.host.dataset.universeNebulaDetailFactor");
    expect(source).toContain("this.updateNebulaAlphas();");
  });

  it("frames large source nebulae as foreground worlds instead of tiny markers", () => {
    const overviewFrame = sourceBetween(
      "private frameOverview(duration: number, canonical: boolean)",
      "private sourceHeroPose(node: ForceNode, depth: number)",
    );

    expect(source).toContain("const NEBULA_SOURCE_RADIUS_MIN = 88");
    expect(source).toContain("const NEBULA_SOURCE_RADIUS_SCALE = 2.25");
    expect(source).toContain("const NEBULA_SOURCE_FRAME_RATIO = 0.76");
    expect(source).toContain("const NEBULA_SOURCE_CORRIDOR_SCALE = 2.35");
    expect(overviewFrame.match(/\* NEBULA_SOURCE_FRAME_RATIO/g)).toHaveLength(3);
  });

  it("lets the browse session own the detail latch and calms the sky under gestures", () => {
    const layout = sourceBetween(
      "private updateVisualLayout(now: number",
      "private evaluateLod(now: number)",
    );
    const controls = sourceBetween(
      "private handleControlsStart = () =>",
      "private handlePointerMove = (event: PointerEvent)",
    );
    const motionStrength = sourceBetween(
      "private nebulaMotionStrength()",
      "private shouldAnimateNebula(",
    );

    // The radius heuristic measures distance to the source's centre, but the
    // flight travels along the axis away from it by design. Unlatching mid-
    // flight hid every card, collapsed the corridor and re-enabled the drift.
    expect(layout).toContain(
      "const browseDetailSourceId = this.timelineJourney.enabled && this.flightConfig",
    );
    expect(layout).toContain("browseDetailSourceId ?? resolveUniverseDetailSource({");
    expect(layout).toMatch(/browseDetailSourceId\s*&& visual\?\.sourceId === browseDetailSourceId\s*\?\s*1/);

    // Camera gestures freeze the ambient drift instead of igniting it.
    expect(controls).not.toContain("this.armNebulaAnimation(");
    expect(controls.match(/cameraCalmUntil = /g)?.length).toBe(2);
    expect(motionStrength).toContain("performance.now() < this.cameraCalmUntil");
  });

  it("stretches a browsed source's nebula into its exploration corridor on the GPU", () => {
    const nebulaMaterial = sourceBetween(
      "function makeNebulaMaterial(darkTheme: boolean)",
      "class UniverseForceSceneEngine",
    );
    const nebulaBuild = sourceBetween(
      "private rebuildNebula()",
      "private updateNebulaPositions()",
    );

    // The corridor is the second form of the same particles: the vertex shader
    // blends galaxy → corridor with the existing detail mix, so diving into a
    // source needs no CPU reposition and no extra particle budget.
    expect(nebulaMaterial).toContain("attribute vec3 aCorridor");
    expect(nebulaMaterial).toContain("attribute float aEmitter");
    expect(nebulaMaterial).toContain("vec3 corridorTarget = position + aCorridor");
    expect(nebulaMaterial).toContain(
      "vec3 journeyTarget = mix(corridorTarget, emitterTarget, aEmitter)",
    );
    expect(nebulaBuild).toContain('geometry.setAttribute("aEmitter"');
    // Dust yields inside the loaded window band, where real packages condensed.
    expect(nebulaMaterial).toContain("uniform float uCorridorNearZ");
    expect(nebulaMaterial).toContain("float loadedBand = smoothstep(");
    expect(source).toContain("const NEBULA_CORRIDOR_LOADED_ALPHA = 0.4");
    expect(nebulaMaterial).toContain(
      "${NEBULA_CORRIDOR_LOADED_ALPHA.toFixed(2)}",
    );
    // Corridor depth lives on the same counting grid as packages and flight.
    expect(nebulaBuild).toContain("UNIVERSE_TEMPORAL_AXIS_UNITS_PER_EVENT");
    expect(nebulaBuild).toContain('geometry.setAttribute("aCorridor"');
    expect(source).toContain("private syncNebulaCorridorUniforms()");
    expect(source).toContain("material.uniforms.uCorridorNearZ.value = config");
    expect(source).toContain("const NEBULA_CORRIDOR_BAND_OFF = 1e8");

    // Corridor dust is camera-anchored: it wraps modulo a fixed span around
    // the flight depth, so density beside the camera never depends on source
    // size — a 586-event book gets the same dust as a 12-event note. The axis
    // still has real ends: an entry-plane fade, a dissolving horizon, and a
    // hard stop past the last event.
    expect(source).toContain("const NEBULA_CORRIDOR_WRAP_SPAN = 2400");
    expect(nebulaBuild).toContain(
      "Math.min(Math.max(1, axisDepth), NEBULA_CORRIDOR_WRAP_SPAN)",
    );
    expect(nebulaMaterial).toContain("uniform float uFlightDepth");
    expect(nebulaMaterial).toContain("float rel = mod(depthAlongAxis - uFlightDepth, span)");
    expect(nebulaMaterial).toContain("float wrappedDepth = uFlightDepth + rel");
    expect(nebulaMaterial).toContain("float entryFade = smoothstep(-220.0, -40.0, wrappedDepth)");
    expect(nebulaMaterial).toContain("float horizonFade = 1.0 - smoothstep(0.82, 1.0, endProgress) * 0.8");
    expect(source).toContain(
      "material.uniforms.uFlightDepth.value = config ? this.appliedFlightDepth : 0",
    );

    // Glow pockets belong to the intact hero. Once the source stretches into
    // a corridor they collapse into fine grains and their alpha is suppressed,
    // so isolated screen-space blobs cannot compete with the graph.
    expect(nebulaMaterial).toContain("vGlow = aGlow * (");
    expect(nebulaMaterial).toContain(
      "smoothstep(0.08, 0.55, corridorMix) * (1.0 - aEmitter)",
    );
    expect(nebulaMaterial).toContain("float originalGlowParticle = step(0.001, aGlow)");
    expect(nebulaMaterial).toContain(
      "vAlpha *= mix(1.0, 0.04, streamMix * originalGlowParticle)",
    );
    expect(nebulaMaterial).toContain("vAlpha *= mix(1.0, axisFade, streamMix)");
    expect(nebulaMaterial).toContain("* detailScale * glowScale * corridorBoost");

    // A balanced mix of near dust and restrained canyon walls keeps the
    // interior luminous without turning the graph into visual noise.
    expect(source).toContain("const NEBULA_WALL_SHARE = 0.46");
    expect(source).toContain("const NEBULA_WALL_LATERAL_MIN = 1.6");
    expect(source).toContain("const NEBULA_WALL_LATERAL_MAX = 3.8");
    expect(source).toContain("const NEBULA_CORRIDOR_DUST_POINT_SIZE_CSS = 5.5");
    expect(source).toContain("const NEBULA_CORRIDOR_GLOW_POINT_SIZE_CSS = 9");
    expect(source).toContain("const NEBULA_CORRIDOR_DUST_ALPHA = 0.5");
    expect(source).toContain("const NEBULA_CORRIDOR_WALL_ALPHA = 0.16");
    expect(nebulaBuild).toContain("NEBULA_WALL_LATERAL_MIN");
    expect(nebulaBuild).toContain('geometry.setAttribute("aCorridorWall"');
    expect(nebulaMaterial).toContain(
      "vAlpha *= mix(1.0, ${NEBULA_CORRIDOR_DUST_ALPHA.toFixed(2)}, streamMix)",
    );
    expect(nebulaMaterial).toContain(
      "${(NEBULA_CORRIDOR_WALL_ALPHA / NEBULA_CORRIDOR_DUST_ALPHA).toFixed(4)}",
    );
    expect(nebulaMaterial).toContain(
      "float corridorBoost = mix(1.0, mix(1.0, 0.62, aCorridorWall), streamMix)",
    );
    expect(nebulaMaterial).toContain("detailDustCap = mix(detailDustCap, corridorDustCap, streamMix)");
    expect(nebulaMaterial).toContain("float capSelect = glowParticle;");

    // While inside one source the rest of the sky recedes deep enough that a
    // white-hot core cannot smudge the corridor, and the browsed source claims
    // a heavier share of the fixed particle budget.
    expect(nebulaMaterial).toContain("vAlpha *= mix(1.0, 0.03, uDetail * (1.0 - sourceMatch))");
    expect(nebulaBuild).toContain("source.sourceId === browsedSourceId ? 6 : 1");
    expect(nebulaBuild).toContain("const browsedSourceId = this.flightConfig?.sourceId ?? null");
  });

  it("clamps browsing rotation to a forward gaze cone that cannot flip the nebula", () => {
    const focus = sourceBetween(
      "focusSource(sourceId: string) {",
      "focusResult() {",
    );
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );

    // Inside a source the wheel's "deeper" must stay roughly ahead: rotation
    // is a bounded human glance, applied after the entry dive lands and
    // released the moment the session leaves or switches sources.
    expect(source).toContain("const BROWSE_GAZE_AZIMUTH_RAD = 0.3");
    expect(source).toContain("const BROWSE_GAZE_POLAR_RAD = 0.22");
    // The orbit pivot sits DEEP in the corridor: dragging tilts the near
    // corridor around the depths, instead of sweeping the depths around a
    // near point — the deep field must hold still under rotation.
    expect(source).toContain("const CORRIDOR_ENTRY_LOOK_AHEAD = 520");
    expect(source).toContain("private applyBrowseGaze()");
    expect(source).toContain("private releaseBrowseGaze()");
    expect(source).toContain(
      "this.controls.minAzimuthAngle = -BROWSE_GAZE_AZIMUTH_RAD",
    );
    expect(source).toContain("this.controls.rotateSpeed = BROWSE_GAZE_ROTATE_SPEED");
    expect(source).toContain("this.controls.rotateSpeed = UNIVERSE_ROTATE_SPEED");
    expect(focus).toContain("this.applyBrowseGaze()");
    expect(dataCommit).toContain("if (!nextFlight || flightSourceChanged) {");
    expect(dataCommit).toContain("this.releaseBrowseGaze()");
  });

  it("dives into the corridor on entry and ducks cards while streaking past", () => {
    const focus = sourceBetween(
      "focusSource(sourceId: string) {",
      "focusResult() {",
    );
    const heroPose = sourceBetween(
      "private sourceHeroPose(node: ForceNode, depth: number)",
      "private markSourceExploring()",
    );
    const flight = sourceBetween(
      "private updateTemporalFlight(now: number)",
      "private timelineWheelSurface(target: EventTarget | null)",
    );
    const labels = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );

    // Entering a browse session flies to the corridor entrance looking down
    // the axis — never a bearing-preserving dolly into a ball of nodes.
    expect(focus).toContain("this.sourceHeroPose(node, this.appliedFlightDepth)");
    expect(heroPose).toContain("flight.centerZ - depth");
    expect(heroPose).toContain("CORRIDOR_ENTRY_STANDOFF");
    expect(heroPose).toContain("entryZ - CORRIDOR_ENTRY_LOOK_AHEAD");

    // Card discipline keys off real depth travel (wheel inertia and button
    // glides alike) and eases asymmetrically: duck fast, recover after a beat.
    expect(flight).toContain("const instantSpeed = Math.abs(delta)");
    expect(flight).toContain("FLIGHT_CARD_COLLAPSE_MS");
    expect(flight).toContain("return moving || cardsSettling");
    expect(labels).toContain(
      "universeCardMorph(this.visualDetailMix * this.flightCardPresence)",
    );
    // Passed packages keep an ember star but never a ghost card.
    expect(labels).toContain("((node.temporalPresenceOpacity ?? 1) - 0.18) / 0.82");

    // Reading is the point: a transient hover dims unrelated cards in place
    // (no reflow, no board jump) — only a locked focus clears the stage — and
    // the network answers a glance with a whisper of scale, not a pop.
    expect(labels).toContain(
      "belongsToLabelSource && transientHover ? nodeCardReveal * 0.35 : 0",
    );
    expect(source).toContain("? this.transientHoverFocusId() ? 1.04 : 1.12");
  });

  it("debounces pointer label rebuilds and restores defaults", () => {
    const hover = sourceBetween(
      "private scheduleHoverLabelRebuild(",
      "private applyHighlight()",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    expect(hover).toContain("HOVER_LABEL_SETTLE_MS");
    expect(hover).toContain("HOVER_CLEAR_GRACE_MS");
    expect(hover).toContain("this.scheduleHoverLabelRebuild()");
    expect(hover).toContain("if (immediate || focusId === null) queueFrame()");
    expect(labelLayout).toContain(
      'const compact = label.kind === "node" && node.kind === "entity"',
    );
    expect(labelLayout).toContain("node.id === labelFocusId");
    expect(source).toContain("this.scheduleHoverLabelRebuild(true)");
    expect(source).toContain("this.cancelHoverLabelRebuild();");
    expect(source).toContain("this.cancelHoverClear();");
  });

  it("keeps one canvas tab stop and roves without moving or loading graph data", () => {
    const keyboard = sourceBetween(
      "private keyboardCandidates()",
      "private updatePixelRatio()",
    );
    const labelBinding = sourceBetween(
      "private bindLabelInteraction(",
      "private updateLabels(now: number",
    );

    expect(source).toContain("tabIndex={interactive ? 0 : -1}");
    expect(source).toContain("this.rendererCanvas.tabIndex = -1");
    expect(source).toContain("aria-live=\"polite\"");
    expect(source).toContain("aria-describedby={keyboardInstructionsId}");
    expect(labelBinding).toContain("element.tabIndex = -1");
    expect(labelBinding).not.toContain('addEventListener("focus"');
    expect(source).toContain('this.host.addEventListener("keydown", this.handleKeyDown)');
    expect(source).not.toContain('window.addEventListener("keydown", this.handleKeyDown)');
    expect(keyboard).toContain("if (!detailSourceId) return true");
    expect(keyboard).toContain('return node.kind !== "source"');
    expect(keyboard).toContain("node.sourceId === detailSourceId");
    expect(keyboard).not.toContain("showEventCards");
    expect(keyboard).not.toContain("showEntityCards");
    expect(keyboard).toContain("nextUniverseKeyboardNodeId(");
    expect(keyboard).toContain("this.callbacks.onNodeClick(node.sceneNode)");
    expect(keyboard).not.toMatch(/focusNode\(|focusSource\(|setData\(|fetch\(|api\./);
    expect(keyboard).not.toMatch(/node\.[fxyz]{1,2}\s*=/);
  });

  it("hard-caps nebula proxy budgets on the client", () => {
    const nebula = sourceBetween(
      "private rebuildNebula()",
      "private updateNebulaPositions()",
    );

    expect(nebula).toContain("const budgetCap = mobile ? 4_000 : 12_000");
    expect(nebula).toContain("const budget = Math.min(");
    expect(nebula).toContain("this.host.dataset.universeNebulaBudgetCap");
    expect(nebula).toContain("this.host.dataset.universeNebulaBudget");
  });

  it("mixes brand-gold event grains with each source's accent colour", () => {
    const nebulaMaterial = sourceBetween(
      "function makeNebulaMaterial(darkTheme: boolean)",
      "class UniverseForceSceneEngine",
    );
    const nebula = sourceBetween(
      "private rebuildNebula()",
      "private updateNebulaPositions()",
    );

    // Gold is the stable event field; source-tinted grains preview the entities
    // that will condense from the same cloud after entry.
    expect(source).toContain('export const UNIVERSE_BRAND_GOLD = "#d6ae63"');
    expect(nebulaMaterial).toContain("uniform vec3 uBrandColor");
    expect(nebulaMaterial).toContain("vColor = mix(uBrandColor, aColor, sourceTint)");
    expect(source).toContain("const SOURCE_PALETTE = [");
    expect(nebula).toContain("const eventGrain = stableUnit(");
    expect(nebula).toContain("const color = eventGrain");
    expect(nebula).toContain("? NEBULA_BRAND_GOLD.clone()");
    expect(nebula).toContain(": this.sourceVisualColor(particle.sourceId)");
    expect(nebula).toContain("const whiteMix = particle.core");
    expect(nebula).toContain("color.lerp(WHITE, whiteMix);");
    expect(source).toContain("export function universeSourceAccent(sourceId: string");
    expect(nebula).toContain("const glowChance = coreParticle ? 0.018 : 0.006");
    expect(source).toContain("const NEBULA_GLOW_POINT_SIZE_CSS_DESKTOP = 16");
    // The hero has a readable spiral silhouette with real z-thickness rather
    // than a flat random disc or an oversized field of fog sprites.
    expect(nebula).toContain("const coreParticle = population < 0.28");
    expect(nebula).toContain("const diffuseParticle = population >= 0.86");
    expect(nebula).toContain("const armCount = 3 +");
    expect(nebula).toContain("const winding = Math.PI * (");
    expect(nebula).toContain("const planarRadius = radius * Math.min(1.02, radial)");
    expect(nebula).toContain("offset.applyEuler(rotation)");
    // Entity sprites and labels use the same source accent as their nebula.
    expect(source).toContain("private entityVisualColor(sourceId: string)");
    expect(source).toContain("this.sourceVisualColor(node.sourceId)");
  });

  it("arrives at a nebula-only initial state and explores through the vestibule", () => {
    const nebulaMaterial = sourceBetween(
      "function makeNebulaMaterial(darkTheme: boolean)",
      "class UniverseForceSceneEngine",
    );
    const focus = sourceBetween(
      "focusSource(sourceId: string) {",
      "focusResult() {",
    );
    const heroPose = sourceBetween(
      "private sourceHeroPose(node: ForceNode, depth: number)",
      "private markSourceExploring()",
    );
    const presence = sourceBetween(
      "private updateTemporalPresence()",
      "private updateTemporalFlight(now: number)",
    );
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );

    // Depth 0 is the hero pose: intact galaxy, no event stars, no cards. The
    // corridor stretch and the packages both materialize only as the camera
    // crosses the vestibule — and dissolve again on the way back out.
    expect(source).toContain("vestibuleDepth: number");
    expect(nebulaMaterial).toContain("uniform float uCorridorVestibule");
    expect(nebulaMaterial).toContain(
      "? smoothstep(0.0, uCorridorVestibule * 0.85, uFlightDepth)",
    );
    expect(nebulaMaterial).toContain(
      "float corridorMix = smoothstep(0.12, 0.88, particleDetail) * diveMix",
    );
    expect(presence).toContain("config.vestibuleDepth * 0.85");
    expect(presence).toContain("const condensation = THREE.MathUtils.lerp(0.14, 1, dive)");
    expect(presence).toContain("scale = presence.scale * condensation");
    expect(presence).toContain("opacity = presence.opacity * dive");
    expect(source).toContain(
      "material.uniforms.uCorridorVestibule.value = config",
    );
    expect(dataCommit).toContain("this.flightState = createUniverseTemporalFlightState(0)");
    expect(dataCommit).toContain("this.appliedFlightDepth = this.flightState.depth");
    expect(dataCommit).toContain("this.markSourceOrigin()");
    // The arrival stands back far enough for the hero framing.
    expect(focus).toContain("this.sourceHeroPose(node, this.appliedFlightDepth)");
    expect(heroPose).toContain("const entryZ = flight.centerZ - depth");
    expect(heroPose).toContain("node.sceneNode.radius * NEBULA_SOURCE_RADIUS_SCALE");
    expect(heroPose).toContain("Math.max(CORRIDOR_ENTRY_STANDOFF, nebulaRadius * 3.45)");
    expect(heroPose).toContain("entryZ + heroStandoff");
  });

  it("coordinates a source-origin retreat before the owner exits to overview", () => {
    const navigation = sourceBetween(
      "  returnToSourceOrigin(sourceId: string):",
      "\n  focusSource(sourceId: string) {",
    );
    const flight = sourceBetween(
      "private updateTemporalFlight(now: number)",
      "private timelineWheelSurface(target: EventTarget | null)",
    );

    // At origin the handle reports that stage one is already complete, which
    // lets the owner perform stage two (the overview zoom-out) on the same API.
    expect(source).toContain(
      'returnToSourceOrigin: (sourceId: string) => "moved" | "already-at-origin"',
    );
    expect(navigation).toContain(
      'if (this.sourceNavigationPhase === "origin" && !this.sourceReturnMotion)',
    );
    expect(navigation).toContain('return "already-at-origin"');
    expect(navigation).toContain(
      'if (this.sourceNavigationPhase === "returning" && this.sourceReturnMotion)',
    );
    expect(navigation).toContain('return "moved"');

    // Retreat is one coordinated motion: selection, gaze, parallax, temporal
    // inertia, camera target and corridor depth all settle together.
    expect(navigation).toContain("const pose = node ? this.sourceHeroPose(node, 0) : null");
    expect(navigation).toContain("this.cancelTimelineTransition(true)");
    expect(navigation).toContain("this.clearSelection()");
    expect(navigation).toContain("this.releaseBrowseGaze()");
    expect(navigation).toContain("this.parallaxApplied = { x: 0, y: 0 }");
    expect(navigation).toContain("this.flightState = brakeUniverseTemporalFlight(this.flightState)");
    expect(navigation).toContain("fromDepth: this.appliedFlightDepth");
    expect(navigation).toContain("fromCamera: this.graph.camera().position.clone()");
    expect(navigation).toContain("toCamera: pose.camera");
    expect(navigation).toContain('this.sourceNavigationPhase = "returning"');
    expect(navigation).toContain("const depth = THREE.MathUtils.lerp(motion.fromDepth, 0, eased)");
    expect(navigation).toContain("this.flightState = createUniverseTemporalFlightState(depth)");
    expect(navigation).toContain("this.graph.camera().position.lerpVectors(");
    expect(navigation).toContain("this.controls.target?.lerpVectors(");
    expect(navigation).toContain("this.syncNebulaCorridorUniforms()");
    expect(navigation).toContain("this.updateTemporalPresence()");
    expect(navigation).toContain("this.markSourceOrigin(now)");
    expect(navigation).toContain("this.applyBrowseGaze()");
    expect(flight).toContain("if (this.sourceReturnMotion) return this.updateSourceReturnMotion(now)");
  });

  it("snaps the imperceptible detail-morph tail so stable scenes can sleep", () => {
    expect(source).toContain("const DETAIL_MORPH_SETTLE_EPSILON = 0.01");
    expect(source).toContain(
      "Math.abs(nextTarget - nextMix) <= DETAIL_MORPH_SETTLE_EPSILON",
    );
    expect(source).toContain(
      "Math.abs(nextTarget - nextMix) > DETAIL_MORPH_SETTLE_EPSILON",
    );
  });

  it("throttles projection morph scales on the camera path without stalling motion", () => {
    const morphScale = sourceBetween(
      "private updateNodeMorphScales(",
      "private updateSourceAuraOpacities()",
    );
    const cameraChange = sourceBetween(
      "private handleControlsChange = () =>",
      "private handlePointerMove = (event: PointerEvent)",
    );
    const objectVisual = sourceBetween(
      "private setObjectOpacity(node: ForceNode",
      "private nodeProjectionScale(node: ForceNode)",
    );

    expect(morphScale).toContain("if (!force && elapsed < 24) return");
    expect(morphScale).toContain("this.lastNodeMorphAt = now");
    expect(cameraChange).toContain("this.updateNodeMorphScales(now)");
    expect(cameraChange).not.toContain("this.updateNodeMorphScales(now, true)");
    // The throttle is only safe because a node mid-timelineMotion still gets the
    // same scale formula applied every frame through setObjectOpacity.
    expect(objectVisual).toContain("this.nodeMorphScale(node)");
  });

  it("waits for camera damping to fall quiet before sleeping the renderer", () => {
    const wake = sourceBetween(
      "private wakeRendering(settleMs = 1800)",
      "private loop = (now: number)",
    );
    const cameraChange = sourceBetween(
      "private handleControlsChange = () =>",
      "private handlePointerMove = (event: PointerEvent)",
    );

    expect(source).toContain("const CAMERA_DAMPING_QUIET_MS = 120");
    expect(source).toContain("const CAMERA_DAMPING_RECHECK_MS = 240");
    expect(cameraChange).toContain("this.lastControlsChangeAt = now");
    expect(wake).toContain(
      "performance.now() - this.lastControlsChangeAt < CAMERA_DAMPING_QUIET_MS",
    );
    expect(wake).toContain("this.wakeRendering(CAMERA_DAMPING_RECHECK_MS)");
    // Reduced motion disables damping outright, so there is no tail to wait for.
    expect(wake).toContain("!this.reducedMotion");
  });

  it("reports import, initialization, and WebGL context failures once", () => {
    expect(source).toContain(
      'this.rendererCanvas.addEventListener("webglcontextlost", this.handleWebglContextLost)',
    );
    expect(source).toContain(
      'this.rendererCanvas.removeEventListener("webglcontextlost", this.handleWebglContextLost)',
    );
    expect(source).toContain('this.callbacks.onUnavailable("context-lost")');
    expect(source).toContain('notifyUnavailable("dynamic-import")');
    expect(source).toContain('?? "initialization"');
    expect(source).toContain("notifyUnavailable(unavailableReason)");
    expect(source).toContain("Failed to initialize the 3D scene");
    expect(source).toContain("classifyUniverseWebGLContextFailure(reason)");
    expect(source).toContain("console.warn(");
    expect(source).not.toContain("console.error(");
    expect(source).toContain("if (unavailableNotifiedRef.current) return;");
  });
});
