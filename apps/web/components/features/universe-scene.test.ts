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

  it("turns the deep wheel gesture into one bounded timeline intent", () => {
    const wheel = sourceBetween(
      "private timelineDepthGateReached()",
      "private updatePixelRatio()",
    );
    const intent = sourceBetween(
      "async moveTimeline(",
      "private createNodeObject(node: ForceNode)",
    );

    expect(source).toContain("export interface UniverseTimelineJourney");
    expect(source).toContain("windowRevision?: number");
    expect(source).toContain('this.host.addEventListener("wheel", this.handleWheel');
    expect(source).toContain("passive: false");
    expect(source).toContain("this.controls.minDistance = TIMELINE_CAMERA_MIN_DISTANCE");
    expect(source).toContain("this.controls.maxDistance = TIMELINE_CAMERA_MAX_DISTANCE");
    expect(wheel).toContain("TIMELINE_EVENT_GATE_PX");
    expect(wheel).toContain("TIMELINE_WHEEL_THRESHOLD");
    expect(wheel).toContain("this.timelineWheelConsumed");
    expect(wheel).toContain("this.holdTimelineWheelGesture()");
    expect(wheel).toContain("event.preventDefault()");
    expect(wheel).toContain("if (inward) this.armLod(event)");
    expect(wheel.indexOf("event.preventDefault()"))
      .toBeGreaterThan(wheel.indexOf("if (!this.timelineJourney.enabled || !gateReached)"));
    expect(intent.indexOf("await this.animateTimelineExit(direction)"))
      .toBeLessThan(intent.lastIndexOf("await this.callbacks.onTimelineIntent(direction)"));
    expect(intent).not.toContain("this.timelineJourney.networkExhausted");
    expect(intent).toContain('this.timelineJourney.phase === "complete"');
    expect(intent).toContain('if (!this.timelineJourney.hasNext) return "blocked"');
    expect(intent).toContain("await this.restoreTimelineExit()");
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

  it("uses the same stable transition for wheel, keyboard and imperative controls", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );

    expect(source).toContain('kind: "enter" | "exit" | "restore"');
    expect(source).toContain("private animateTimelineExit(");
    expect(source).toContain("private restoreTimelineExit()");
    expect(source).toContain("this.timelineExitSide(node, source)");
    expect(source).toContain("TIMELINE_EXIT_MIN_MS");
    expect(source).toContain("TIMELINE_ENTRY_MS");
    expect(dataCommit).toContain("const animateTimelineWindow = windowChanged");
    expect(dataCommit).toContain("nextWindowRevision !== this.dataWindowRevision");
    expect(dataCommit).toContain("timelineEntryFor(sceneNode, desired, currentSource)");
    expect(dataCommit).toContain('this.timelineMotionPhase = "entering"');
    expect(source).toContain("const startWindowRevision = this.dataWindowRevision");
    expect(source).toContain("this.dataWindowRevision === startWindowRevision");
    expect(source).toContain("this.dataWindowRevision !== startWindowRevision");
    expect(source).toContain('event.key === "PageDown" ? "next" : "previous"');
    expect(source).toContain(
      "moveTimeline: (direction) => engineRef.current?.moveTimeline(direction)",
    );
    expect(source).toContain("if (this.reducedMotion) return this.waitForTimelineMotions");
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
    expect(interruptionGuard).toContain('this.timelineMotionPhase === "exiting"');
    expect(interruptionGuard).toContain('if (cause === "journey") return false');
    expect(interruptionGuard).toContain('this.timelineMotionPhase === "awaiting-result"');
    expect(interruptionGuard).toContain('this.timelineMotionPhase === "awaiting-data"');
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

  it("budgets both card kinds independently and forces the focused card into a real one-hop network", () => {
    const labels = sourceBetween(
      "private rebuildLabels()",
      "private sortLabelsForLayout()",
    );
    expect(labels).toContain("const showEventCards = this.viewPreferences.showEventCards");
    expect(labels).toContain('|| focusNode?.kind === "event"');
    expect(labels).toContain("const showEntityCards = this.viewPreferences.showEntityCards");
    expect(labels).toContain('|| focusNode?.kind === "entity"');
    expect(labels).toContain("const cardBudget = universeCardBudget(");
    expect(labels).toContain('&& (node.kind === "event" ? showEventCards : showEntityCards)');
    expect(labels).toContain("const eventLimit = showEventCards");
    expect(labels).toContain("Math.max(cardBudget.events, focusNode?.kind === \"event\" ? 1 : 0)");
    expect(labels).toContain("const entityLimit = showEntityCards");
    expect(labels).toContain("Math.max(cardBudget.entities, focusNode?.kind === \"entity\" ? 1 : 0)");
    expect(labels).toContain(
      "(!focusId || node.id === focusId || focusNeighbors?.has(node.id))",
    );
    expect(labels).toContain('(node.sceneNode.state === "active" || node.id === focusId)');
    expect(labels).toContain('element.dataset.compact = String(node.kind === "entity")');
    expect(labels).toContain('node.kind === "event" && node.id === focusId');
    expect(labels).toContain("total: totalLimit");
    expect(labels).toContain("const eventCandidateLimit = Math.min(60, eventLimit * 3)");
    expect(labels).toContain("const entityCandidateLimit = Math.min(60, entityLimit * 3)");
    expect(labels).toContain("this.labelPlacementBudget = {");
    expect(labels).toContain("this.host.dataset.universeEntityLabelCandidateCount");
    expect(source).toContain(
      'const expanded = node.kind === "event" && node.id === labelFocusId',
    );
    expect(source).toContain("visibleEntityLabels >= this.labelPlacementBudget.entities");
    expect(source).toContain("this.host.dataset.universeEntityLabelCount");

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

  it("keeps event stars visible, reachable and clear of default cards", () => {
    const nodeObject = sourceBetween(
      "private createNodeObject(node: ForceNode)",
      "private pinNode(node: ForceNode)",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect()",
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
      "const overlapsEventStar = (rect: LabelRect) => compact",
    );
    expect(labelLayout).toContain("!overlapsEventStar(candidate)");
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
    expect(source).toContain("THREE.MathUtils.lerp(0.28, 0.09, load)");
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
    expect(source).toContain("if (hadEntry) this.syncGraphObjectPositions()");
    expect(source).toContain("const position = candidate.entry?.to ?? candidate");
    expect(source).toContain("const entryKeepAliveMs = [...nextNodes.values()].reduce");
    expect(source).toContain("this.startLoop(entryKeepAliveMs)");
    expect(linkStyle).toContain("opacity: this.restingLinkOpacity()");
    expect(linkStyle).toContain("if (this.labelFocusId())");
  });

  it("retires source proxies once concrete event stars enter detail", () => {
    expect(source).toContain("sprite.userData.sourceCore = true");
    expect(source).toContain("private sourceMarkerDetailFactor(");
    expect(source).toContain("return Math.max(0, 1 - detail)");
    expect(source).toContain("this.host.dataset.universeNebulaDetailFactor");
    expect(source).toContain("if (particle.sourceId === this.visualSourceId)");
    expect(source).toContain("this.updateNebulaAlphas();");
  });

  it("debounces pointer label rebuilds and restores defaults", () => {
    const hover = sourceBetween(
      "private scheduleHoverLabelRebuild(",
      "private applyHighlight()",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect()",
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
      "private armLod =",
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

  it("reports import, initialization, and WebGL context failures once", () => {
    expect(source).toContain(
      'this.rendererCanvas.addEventListener("webglcontextlost", this.handleWebglContextLost)',
    );
    expect(source).toContain(
      'this.rendererCanvas.removeEventListener("webglcontextlost", this.handleWebglContextLost)',
    );
    expect(source).toContain('this.callbacks.onUnavailable("context-lost")');
    expect(source).toContain('notifyUnavailable("dynamic-import")');
    expect(source).toContain('notifyUnavailable("initialization")');
    expect(source).toContain("if (unavailableNotifiedRef.current) return;");
  });
});
