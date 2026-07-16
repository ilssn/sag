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
    expect(dataCommit).toContain("if (!this.paused && searchFocusSourceId) this.focusSource(");
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
      "private handlePointerDown = () =>",
    );
    const wheelRouting = sourceBetween(
      "private timelineWheelSurface(target: EventTarget | null)",
      "private handleTimelineWheel = (event: WheelEvent) =>",
    );
    const pointer = sourceBetween(
      "private handlePointerDown = () =>",
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
    expect(diagnostics).toContain("label.element.disabled = busy");
    expect(labelInteraction).toContain("if (this.timelineIsBusy()) return");
    expect(keyboard).toContain('this.timelineIsBusy() && event.key !== "Escape"');
    expect(keyboard).toContain('event.key.startsWith("Arrow")');
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
    expect(labels).toContain('element.dataset.compact = String(node.kind === "entity")');
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
    expect(layout).toContain('const expanded = node.kind === "event"');
    expect(layout).toContain("&& node.id === labelFocusId");
    expect(layout).toContain("const requiredFocusCard =");
    expect(layout).toContain("Boolean(focusCardIds?.has(node.id))");
    expect(layout).toContain("new Set([labelFocusId, ...(labelFocusNeighbors ?? [])])");
    expect(layout).toContain("Math.max(0.72, calculatedOpacity)");
    expect(layout).toContain("const clampedCandidates = requiredFocusCard");
    expect(layout).toContain("const focusGridCandidates: LabelRect[] = []");
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
    expect(options).toContain("if (this.dataReady && (cardPreferencesChanged || localeChanged)) this.rebuildLabels()");
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

    expect(nodeObject).toContain("map: this.entityTexture");
    expect(nodeObject).toContain("map: this.entityCoreTexture");
    expect(nodeObject).toContain("halo.userData.entityHalo = true");
    expect(nodeObject).toContain("sprite.userData.entityCore = true");
    expect(nodeObject).toContain("hit.userData.entityHitArea = true");
    expect(nodeObject).toContain("const coreSize = node.sceneNode.root ? 5.2 : 4");
    expect(nodeObject).toContain("sprite.renderOrder = 2");
    expect(source).toContain(": node.sceneNode.root ? 10 : 8");
    expect(source).toContain("this.host.dataset.universeEntityGlyphCount");
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
    expect(highlight).toContain("if (anchorId && !transientHover)");
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
    expect(source).toContain("const NEBULA_DETAIL_ALPHA = 1.15");
    expect(source).toContain("const NEBULA_DETAIL_DUST_POINT_SIZE_CSS = 22");
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
    expect(nebulaMaterial).toContain(
      "vec3 animatedPosition = position + aCorridor * corridorMix",
    );
    // Dust yields inside the loaded window band, where real packages condensed.
    expect(nebulaMaterial).toContain("uniform float uCorridorNearZ");
    expect(nebulaMaterial).toContain("float loadedBand = smoothstep(");
    expect(nebulaMaterial).toContain("vAlpha *= mix(1.0, 0.16, corridorMix * loadedBand)");
    // Corridor depth lives on the same counting grid as packages and flight.
    expect(nebulaBuild).toContain("UNIVERSE_TEMPORAL_AXIS_UNITS_PER_EVENT");
    expect(nebulaBuild).toContain('geometry.setAttribute("aCorridor"');
    expect(source).toContain("private syncNebulaCorridorUniforms()");
    expect(source).toContain("material.uniforms.uCorridorNearZ.value = config");
    expect(source).toContain("const NEBULA_CORRIDOR_BAND_OFF = 1e8");

    // The corridor carries its own light and has no visible far wall: glow
    // pockets brighten and swell, and the last stretch dissolves.
    expect(nebulaMaterial).toContain("attribute float aCorridorFade");
    expect(nebulaMaterial).toContain("vAlpha *= mix(1.0, 1.3, corridorMix * glowParticle)");
    expect(nebulaMaterial).toContain("vAlpha *= mix(1.0, aCorridorFade, corridorMix)");
    expect(nebulaMaterial).toContain("* detailScale * glowScale * corridorBoost");
    expect(nebulaBuild).toContain('geometry.setAttribute("aCorridorFade"');

    // Most dust becomes the distant canyon walls: far out laterally, grown
    // broad and soft, so a gaze turn barely parallaxes the surrounding nebula.
    expect(source).toContain("const NEBULA_WALL_SHARE = 0.62");
    expect(nebulaBuild).toContain("NEBULA_WALL_LATERAL_MIN");
    expect(nebulaBuild).toContain('geometry.setAttribute("aCorridorWall"');
    expect(nebulaMaterial).toContain("mix(1.0, 2.4, corridorMix * aCorridorWall)");
    expect(nebulaMaterial).toContain("vAlpha *= mix(1.0, 0.6, corridorMix * aCorridorWall)");
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
    expect(source).toContain("const BROWSE_GAZE_AZIMUTH_RAD = 0.55");
    expect(source).toContain("const BROWSE_GAZE_POLAR_RAD = 0.42");
    expect(source).toContain("private applyBrowseGaze()");
    expect(source).toContain("private releaseBrowseGaze()");
    expect(source).toContain(
      "this.controls.minAzimuthAngle = -BROWSE_GAZE_AZIMUTH_RAD",
    );
    expect(source).toContain("this.controls.rotateSpeed = BROWSE_GAZE_ROTATE_SPEED");
    expect(source).toContain("this.controls.rotateSpeed = UNIVERSE_ROTATE_SPEED");
    expect(focus).toContain("this.applyBrowseGaze()");
    expect(dataCommit).toContain(
      "if (!nextFlight || flightSourceChanged) this.releaseBrowseGaze()",
    );
  });

  it("dives into the corridor on entry and ducks cards while streaking past", () => {
    const focus = sourceBetween(
      "focusSource(sourceId: string) {",
      "focusResult() {",
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
    expect(focus).toContain("flight.centerZ - this.appliedFlightDepth");
    expect(focus).toContain("CORRIDOR_ENTRY_STANDOFF");
    expect(focus).toContain("entryZ - CORRIDOR_ENTRY_LOOK_AHEAD");

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

    expect(nebula).toContain("const budgetCap = mobile ? 1_200 : 3_000");
    expect(nebula).toContain("const budget = Math.min(");
    expect(nebula).toContain("this.host.dataset.universeNebulaBudgetCap");
    expect(nebula).toContain("this.host.dataset.universeNebulaBudget");
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
