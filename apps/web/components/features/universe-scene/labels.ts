"use client";

/**
 * 标签/卡片子系统（自 universe-scene-engine 拆出）。
 * DOM 标签重建、逐帧布局与不透明度、hover 焦点节流;宿主为引擎实例。
 */

import * as THREE from "three";

import { planUniverseFocusCards } from "@/lib/universe";
import { universeCardMorph } from "@/lib/universe";
import { universeCardBudget } from "@/lib/universe";
import { currentNodePresentationCardScale, currentNodePresentationOpacity, currentNodePresentationScale, stableUnit } from "./internals";
import type { ForceNode, SceneLabel } from "./engine";
import type { UniverseForceSceneEngine as Engine } from "./engine";

const HOVER_LABEL_SETTLE_MS = 72;

const CARD_DEPTH_BLUR_CSS = 3.2;

export function labelFocusId(engine: Engine) {
  const focusId = engine.lockedId
    ?? engine.selectedId
    ?? engine.keyboardFocusedId;
  return focusId && engine.nodes.get(focusId)?.kind !== "source" ? focusId : null;
}

/** Focus used by WebGL/link highlighting; unlike layout focus it includes a transient hover. */

export function cancelHoverLabelRebuild(engine: Engine) {
  if (engine.hoverLabelTimer !== null) window.clearTimeout(engine.hoverLabelTimer);
  if (engine.hoverLabelFrame !== null) cancelAnimationFrame(engine.hoverLabelFrame);
  engine.hoverLabelTimer = null;
  engine.hoverLabelFrame = null;
}

export function scheduleHoverLabelRebuild(engine: Engine, immediate = false) {
  const focusId = labelFocusId(engine);
  cancelHoverLabelRebuild(engine);
  if (focusId === engine.renderedLabelFocusId) return;
  const queueFrame = () => {
    engine.hoverLabelTimer = null;
    engine.hoverLabelFrame = requestAnimationFrame(() => {
      engine.hoverLabelFrame = null;
      if (
        labelFocusId(engine) !== focusId
        || engine.renderedLabelFocusId === focusId
      ) return;
      rebuildLabels(engine);
    });
  };
  if (immediate || focusId === null) queueFrame();
  else engine.hoverLabelTimer = window.setTimeout(queueFrame, HOVER_LABEL_SETTLE_MS);
}

export function updateHoverLabelState(engine: Engine) {
  const transientId = engine.transientHoverFocusId();
  const emphasizedId = engine.lockedId
    ?? engine.selectedId
    ?? engine.keyboardFocusedId
    ?? engine.hoveredId;
  engine.labels.forEach((label) => {
    const node = engine.nodes.get(label.nodeId);
    if (!node) return;
    const hovered = node.id === engine.hoveredId;
    const emphasized = node.id === emphasizedId;
    label.element.dataset.hovered = String(hovered);
    label.element.dataset.highlighted = String(
      emphasized || engine.sourceHits.some((hit) => hit.source_id === node.sourceId),
    );
    const baseOpacity = Number(label.element.dataset.baseOpacity);
    if (Number.isFinite(baseOpacity)) {
      label.element.style.opacity = String(
        baseOpacity * hoverLabelOpacityFactor(engine, node),
      );
    }
    label.element.dataset.expanded = String(
      node.kind === "event"
        && node.id === labelFocusId(engine)
        && !transientId,
    );
    label.element.style.zIndex = emphasized
      ? "4"
      : label.kind === "node" ? "2" : "1";
  });
}

export function hoverLabelOpacityFactor(engine: Engine, node: ForceNode) {
  const anchorId = engine.transientHoverFocusId();
  if (!anchorId || node.kind === "source") return 1;
  if (node.id === anchorId) return 1;
  if (engine.adjacency.get(anchorId)?.has(node.id)) return 0.76;
  return 0.16;
}

export function rebuildLabels(engine: Engine) {
  const focusId = labelFocusId(engine);
  const transientHover = focusId !== null && focusId === engine.transientHoverFocusId();
  cancelHoverLabelRebuild(engine);
  const retainedLabelRank = new Map(
    engine.labels
      .filter((label) => label.kind === "node")
      .map((label, index) => [label.nodeId, index]),
  );
  engine.rebuildingLabels = true;
  const existingLabels = new Map(
    engine.labels.map((label) => [`${label.kind}:${label.nodeId}`, label]),
  );
  const nextLabels: SceneLabel[] = [];
  let reusedLabelCount = 0;
  const mobile = engine.host.clientWidth < 768;
  const sourceRank = new Map(engine.sourceHits.map((hit, index) => [hit.source_id, index]));
  const focusNeighbors = focusId ? engine.adjacency.get(focusId) ?? new Set<string>() : null;
  const labelSourceId = focusId
    ? engine.nodes.get(focusId)?.sourceId ?? engine.visualSourceId
    : engine.visualSourceId;
  engine.renderedLabelFocusId = focusId;
  engine.host.dataset.universeLabelFocus = focusId ?? "";
  engine.host.dataset.universeLabelNeighborCount = String(focusNeighbors?.size ?? 0);
  const sources = [...engine.sourceNodeList]
    .sort((left, right) => {
      const leftRank = sourceRank.get(left.sourceId);
      const rightRank = sourceRank.get(right.sourceId);
      if (leftRank !== undefined || rightRank !== undefined) {
        return (leftRank ?? 10_000) - (rightRank ?? 10_000);
      }
      return right.sceneNode.importance - left.sceneNode.importance;
    })
    .slice(0, mobile ? 8 : 18);
  const focusCardPlan = planUniverseFocusCards(
    [...engine.nodes.values()]
      .filter((node): node is ForceNode & { kind: "event" | "entity" } =>
        node.kind === "event" || node.kind === "entity"),
    focusId,
    focusNeighbors ?? [],
    labelSourceId,
  );
  const focusCardIds = new Set(focusCardPlan.ids);
  const hasConcreteFocus = focusCardIds.size > 0;
  engine.host.dataset.universeFocusCardCount = String(focusCardPlan.ids.length);
  engine.host.dataset.universeFocusEventCardCount = String(focusCardPlan.eventCount);
  engine.host.dataset.universeFocusEntityCardCount = String(focusCardPlan.entityCount);
  // Card preferences control the resting scene. Hover, keyboard focus and
  // click lock all reveal the complete factual one-hop group.
  const showEventCards = engine.viewPreferences.showEventCards || hasConcreteFocus;
  const showEntityCards = engine.viewPreferences.showEntityCards || hasConcreteFocus;
  const cardBudget = universeCardBudget(
    Math.max(1, engine.host.clientWidth),
    Math.max(1, engine.host.clientHeight),
    showEventCards,
    showEntityCards,
  );
  const prioritize = (left: ForceNode, right: ForceNode) => {
    const emphasisRank = (node: ForceNode) => {
      if (node.id === engine.lockedId) return 0;
      if (node.id === engine.selectedId) return 1;
      if (node.id === engine.keyboardFocusedId) return 2;
      if (node.id === engine.hoveredId) return 3;
      return 4;
    };
    const emphasisDifference = emphasisRank(left) - emphasisRank(right);
    if (emphasisDifference) return emphasisDifference;
    const leftConnected = Boolean(focusNeighbors?.has(left.id));
    const rightConnected = Boolean(focusNeighbors?.has(right.id));
    if (leftConnected !== rightConnected) return leftConnected ? -1 : 1;
    const leftTimelineOrder = left.sceneNode.timelineOrder;
    const rightTimelineOrder = right.sceneNode.timelineOrder;
    if ((leftTimelineOrder !== undefined) !== (rightTimelineOrder !== undefined)) {
      return leftTimelineOrder !== undefined ? -1 : 1;
    }
    if (leftTimelineOrder !== undefined && rightTimelineOrder !== undefined) {
      const timelineDifference = leftTimelineOrder - rightTimelineOrder;
      if (timelineDifference) return timelineDifference;
    }
    if (left.sceneNode.root !== right.sceneNode.root) return left.sceneNode.root ? -1 : 1;
    const importanceDifference = right.sceneNode.importance - left.sceneNode.importance;
    if (importanceDifference) return importanceDifference;
    const leftRetained = retainedLabelRank.has(left.id);
    const rightRetained = retainedLabelRank.has(right.id);
    if (leftRetained !== rightRetained) return leftRetained ? -1 : 1;
    const retainedDifference = (retainedLabelRank.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (retainedLabelRank.get(right.id) ?? Number.MAX_SAFE_INTEGER);
    return retainedDifference || left.id.localeCompare(right.id);
  };
  const candidates = [...engine.nodes.values()].filter((node) =>
    node.kind !== "source"
    && (node.kind === "event" ? showEventCards : showEntityCards)
    && (node.sceneNode.state === "active" || focusCardIds.has(node.id))
    && node.sourceId === labelSourceId
    && (!focusId || focusCardIds.has(node.id))
  );
  const eventLimit = showEventCards
    ? Math.max(cardBudget.events, focusCardPlan.eventCount)
    : 0;
  const entityLimit = showEntityCards
    ? Math.max(cardBudget.entities, focusCardPlan.entityCount)
    : 0;
  const totalLimit = hasConcreteFocus
    ? Math.max(cardBudget.total, focusCardPlan.ids.length)
    : cardBudget.total;
  engine.labelPlacementBudget = {
    events: Math.min(eventLimit, totalLimit),
    entities: Math.min(entityLimit, totalLimit),
    total: totalLimit,
  };
  const eventCandidateLimit = hasConcreteFocus
    ? focusCardPlan.eventCount
    : Math.min(60, eventLimit * 3);
  const entityCandidateLimit = hasConcreteFocus
    ? focusCardPlan.entityCount
    : Math.min(60, entityLimit * 3);
  const totalCandidateLimit = hasConcreteFocus
    ? focusCardPlan.ids.length
    : Math.min(60, totalLimit * 3);
  const activeNodes = [
    ...candidates
      .filter((node) => node.kind === "event")
      .sort(prioritize)
      .slice(0, eventCandidateLimit),
    ...candidates
      .filter((node) => node.kind === "entity")
      .sort(prioritize)
      .slice(0, entityCandidateLimit),
  ]
    .sort(prioritize)
    .slice(0, totalCandidateLimit);

  sources.forEach((node) => {
    const labelKey = `source:${node.id}`;
    const retained = existingLabels.get(labelKey);
    const element = retained?.primary ?? document.createElement("button");
    if (retained) {
      reusedLabelCount += 1;
      existingLabels.delete(labelKey);
    } else {
      element.type = "button";
      element.className = "sag-nebula-label";
      const marker = document.createElement("span");
      marker.className = "sag-nebula-label__marker";
      const copy = document.createElement("span");
      copy.append(document.createElement("strong"), document.createElement("small"));
      element.append(marker, copy);
      bindLabelInteraction(engine, element, node);
      engine.labelLayer.appendChild(element);
    }
    element.dataset.universeNodeId = node.id;
    element.disabled = engine.timelineIsBusy();
    element.setAttribute("aria-label", engine.text.exploreSource(node.sceneNode.label));
    element.style.setProperty(
      "--nebula-color",
      `#${engine.sourceVisualColor(node.sourceId).getHexString()}`,
    );
    element.style.setProperty(
      "--nebula-phase",
      `${(-1.2 - stableUnit(`${node.id}:beacon-phase`) * 4.8).toFixed(2)}s`,
    );
    const title = element.querySelector("strong") as HTMLElement;
    title.textContent = node.sceneNode.label;
    const meta = element.querySelector("small") as HTMLElement;
    meta.textContent = node.sceneNode.statsReady
      ? engine.text.sourceStats(node.sceneNode.eventCount, node.sceneNode.entityCount)
      : engine.text.sourceStatsBuilding(node.sceneNode.eventCount);
    nextLabels.push({
      nodeId: node.id,
      kind: "source",
      element,
      primary: element,
      actionButtons: [],
    });
  });
  activeNodes.forEach((node) => {
    const nodeKind = node.kind === "event" ? "event" : "entity";
    const labelKey = `node:${node.id}`;
    const retained = existingLabels.get(labelKey);
    const element = retained?.element ?? document.createElement("div");
    const primary = retained?.primary ?? document.createElement("button");
    const actionButtons = retained?.actionButtons ?? [
      document.createElement("button"),
      document.createElement("button"),
    ];
    if (retained) {
      reusedLabelCount += 1;
      existingLabels.delete(labelKey);
    } else {
      element.className = "sag-universe-node-label";
      primary.type = "button";
      primary.className = "sag-universe-node-label__primary";
      const eyebrow = document.createElement("span");
      eyebrow.className = "sag-universe-node-label__eyebrow";
      const marker = document.createElement("span");
      marker.className = "sag-universe-node-label__marker";
      eyebrow.append(marker, document.createElement("span"));
      const exploreHint = document.createElement("span");
      exploreHint.className = "sag-universe-node-label__explore";
      exploreHint.dataset.universeNodeExploreHint = "true";
      primary.append(
        eyebrow,
        document.createElement("strong"),
        document.createElement("p"),
        exploreHint,
      );
      const actions = document.createElement("div");
      actions.className = "sag-universe-node-label__actions";
      actions.dataset.universeNodeActions = "true";
      actionButtons.forEach((button, index) => {
        button.type = "button";
        button.className = "sag-universe-node-label__action";
        button.dataset.universeNodeAction = index === 0 ? "explore-more" : "ask-ai";
      });
      actions.append(...actionButtons);
      element.append(primary, actions);
      bindNodeLabelInteraction(engine, element, primary, actionButtons, node);
      engine.labelLayer.appendChild(element);
    }
    element.dataset.universeNodeId = node.id;
    primary.disabled = engine.timelineIsBusy();
    actionButtons.forEach((button, index) => {
      button.disabled = engine.timelineIsBusy() || (
        index === 0 && node.sceneNode.canExploreMore === false
      );
    });
    element.dataset.kind = node.kind;
    if (node.kind === "entity") {
      element.style.setProperty(
        "--universe-node-accent",
        `#${engine.sourceVisualColor(node.sourceId).getHexString()}`,
      );
    } else {
      element.style.removeProperty("--universe-node-accent");
    }
    const locked = node.id === engine.lockedId;
    element.dataset.locked = String(locked);
    element.dataset.expanded = String(
      locked || (node.kind === "event" && node.id === focusId && !transientHover),
    );
    element.dataset.compact = String(node.kind === "entity" && !locked);
    primary.setAttribute(
      "aria-label",
      engine.text.exploreNode(nodeKind, node.sceneNode.label),
    );
    const eyebrowText = primary.querySelector(
      ".sag-universe-node-label__eyebrow > span:last-child",
    ) as HTMLElement;
    eyebrowText.textContent = `${engine.text.kind(nodeKind)} · ${node.sceneNode.category}`;
    const title = primary.querySelector("strong") as HTMLElement;
    title.textContent = node.sceneNode.label;
    title.removeAttribute("title");
    const summary = primary.querySelector("p") as HTMLElement;
    const summaryText = node.sceneNode.description || (node.kind === "entity"
      ? engine.text.relatedEvents(node.sceneNode.relatedCount, node.sceneNode.category)
      : node.sceneNode.category || engine.text.extractedEvent);
    summary.textContent = summaryText;
    summary.removeAttribute("title");
    let exploreHint = primary.querySelector<HTMLElement>(
      "[data-universe-node-explore-hint]",
    );
    if (!exploreHint) {
      exploreHint = document.createElement("span");
      exploreHint.className = "sag-universe-node-label__explore";
      exploreHint.dataset.universeNodeExploreHint = "true";
      primary.appendChild(exploreHint);
    }
    const relatedProgress = Math.max(0, node.sceneNode.relatedProgress ?? 0);
    const relatedTotal = node.sceneNode.relatedCountKnown
      ? Math.max(relatedProgress, node.sceneNode.relatedCount)
      : "?";
    const hintVisible = node.id === focusId
      && !engine.lockedId
      && !engine.selectedId;
    exploreHint.hidden = !hintVisible;
    exploreHint.textContent = node.sceneNode.canExploreMore
      ? engine.text.continueExploring(relatedProgress, relatedTotal)
      : typeof relatedTotal === "number" && relatedProgress >= relatedTotal
        ? engine.text.explorationComplete(relatedProgress, relatedTotal)
        : engine.text.explorationProgress(relatedProgress, relatedTotal);
    const actions = element.querySelector<HTMLElement>("[data-universe-node-actions]");
    if (actions) actions.hidden = !locked;
    const exploreMoreAction = engine.text.exploreMoreAction ?? "Explore more";
    const askAiAction = engine.text.askAiAction ?? "Ask AI";
    actionButtons[0].textContent = exploreMoreAction;
    actionButtons[0].setAttribute("aria-label", exploreMoreAction);
    actionButtons[1].textContent = askAiAction;
    actionButtons[1].setAttribute("aria-label", askAiAction);
    nextLabels.push({
      nodeId: node.id,
      kind: "node",
      element,
      primary,
      actionButtons,
    });
  });
  existingLabels.forEach((label) => label.element.remove());
  engine.labels = nextLabels;
  engine.host.dataset.universeReusedLabelCount = String(reusedLabelCount);
  engine.host.dataset.universeEventLabelCandidateCount = String(
    activeNodes.filter((node) => node.kind === "event").length,
  );
  engine.host.dataset.universeEntityLabelCandidateCount = String(
    activeNodes.filter((node) => node.kind === "entity").length,
  );
  sortLabelsForLayout(engine);
  updateLabels(engine, performance.now(), true);
  engine.rebuildingLabels = false;
}

export function sortLabelsForLayout(engine: Engine) {
  const focusId = labelFocusId(engine);
  const focusNeighbors = focusId
    ? engine.adjacency.get(focusId) ?? new Set<string>()
    : null;
  engine.labels.sort((left, right) => {
    const layoutRank = (label: SceneLabel) => {
      if (label.nodeId === engine.lockedId) return 0;
      if (label.nodeId === engine.selectedId) return 1;
      if (label.nodeId === engine.keyboardFocusedId) return 2;
      if (label.nodeId === engine.hoveredId) return 3;
      if (focusNeighbors?.has(label.nodeId)) return 4;
      return label.kind === "source" ? 5 : 6;
    };
    const rankDifference = layoutRank(left) - layoutRank(right);
    if (rankDifference) return rankDifference;
    const leftOrder = engine.nodes.get(left.nodeId)?.sceneNode.timelineOrder;
    const rightOrder = engine.nodes.get(right.nodeId)?.sceneNode.timelineOrder;
    if ((leftOrder !== undefined) !== (rightOrder !== undefined)) {
      return leftOrder !== undefined ? -1 : 1;
    }
    if (leftOrder !== undefined && rightOrder !== undefined) {
      const timelineDifference = leftOrder - rightOrder;
      if (timelineDifference) return timelineDifference;
    }
    return left.nodeId.localeCompare(right.nodeId);
  });
}

export function bindLabelInteraction(engine: Engine, element: HTMLButtonElement, node: ForceNode) {
  element.tabIndex = -1;
  const stopPointerPropagation = (event: PointerEvent) => event.stopPropagation();
  const holdCanvasFocus = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const focusNode = (event: PointerEvent) => {
    engine.pointerActive = true;
    engine.pointerX = event.clientX;
    engine.pointerY = event.clientY;
    engine.handleNodeHover(node, true);
  };
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (engine.timelineIsBusy()) return;
    engine.clearKeyboardFocus(false);
    engine.callbacks.onNodeClick(node.sceneNode);
  });
  element.addEventListener("pointerdown", holdCanvasFocus);
  element.addEventListener("pointerup", stopPointerPropagation);
  element.addEventListener("pointercancel", stopPointerPropagation);
  element.addEventListener("pointerenter", focusNode);
  element.addEventListener("pointermove", focusNode, { passive: true });
  element.addEventListener("pointerleave", () => {
    if (!engine.rebuildingLabels) engine.handleNodeHover(null);
  });
}

export function bindNodeLabelInteraction(engine: Engine, 
  container: HTMLElement,
  primary: HTMLButtonElement,
  actionButtons: HTMLButtonElement[],
  node: ForceNode,
) {
  primary.tabIndex = -1;
  const stopPointerPropagation = (event: PointerEvent) => event.stopPropagation();
  const holdCanvasFocus = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const focusNode = (event: PointerEvent) => {
    engine.pointerActive = true;
    engine.pointerX = event.clientX;
    engine.pointerY = event.clientY;
    engine.handleNodeHover(node, true);
  };
  primary.addEventListener("click", (event) => {
    event.stopPropagation();
    if (engine.timelineIsBusy()) return;
    engine.clearKeyboardFocus(false);
    engine.callbacks.onNodeClick(node.sceneNode);
  });
  primary.addEventListener("pointerdown", holdCanvasFocus);
  primary.addEventListener("pointerup", stopPointerPropagation);
  primary.addEventListener("pointercancel", stopPointerPropagation);
  actionButtons.forEach((button, index) => {
    button.addEventListener("pointerdown", stopPointerPropagation);
    button.addEventListener("pointerup", stopPointerPropagation);
    button.addEventListener("pointercancel", stopPointerPropagation);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (engine.timelineIsBusy() || node.id !== engine.lockedId) return;
      engine.clearKeyboardFocus(false);
      if (index === 0) engine.callbacks.onExploreMore?.(node.sceneNode);
      else engine.callbacks.onAskNode?.(node.sceneNode);
    });
  });
  container.addEventListener("pointerenter", focusNode);
  container.addEventListener("pointermove", focusNode, { passive: true });
  container.addEventListener("pointerleave", () => {
    if (!engine.rebuildingLabels) engine.handleNodeHover(null);
  });
}

export function updateLabels(engine: Engine, now: number, force = false) {
  if (!force && now - engine.lastLabelAt < 32) return;
  engine.lastLabelAt = now;
  const width = Math.max(1, engine.host.clientWidth);
  const height = Math.max(1, engine.host.clientHeight);
  const mobile = width < 768;
  const camera = engine.graph.camera();
  // One layout read per pass. Previously each overlay lookup re-read the host
  // bounds, forcing repeated layout flushes while the camera was moving.
  const hostRect = engine.host.getBoundingClientRect();
  const panelRect = engine.miniPanelRect(hostRect);
  const summaryRect = engine.relativeOverlayRect(
    "[data-universe-summary='true']",
    8,
    hostRect,
  );
  const progressRect = engine.relativeOverlayRect(
    "[data-universe-load-progress='true']",
    8,
    hostRect,
  );
  const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  let visibleEventLabels = 0;
  let visibleEntityLabels = 0;
  // Flight speed scales the complete card as one object. Internal content
  // never stages independently, so the board cannot jump between layouts.
  const cardMorphProgress = engine.visualDetailMix * engine.flightCardPresence;
  const globalCardMorph = universeCardMorph(cardMorphProgress);
  const sourceReveal = 1 - THREE.MathUtils.smoothstep(engine.visualDetailMix, 0, 0.72);
  const labelFocusId = resolveLabelFocusId(engine);
  const transientHover = labelFocusId !== null
    && labelFocusId === engine.transientHoverFocusId();
  const overviewCardOverride = Boolean(labelFocusId && engine.visualDetailMix < 0.5);
  const labelFocusNeighbors = labelFocusId
    ? engine.adjacency.get(labelFocusId) ?? new Set<string>()
    : null;
  const focusCardIds = labelFocusId
    ? new Set([labelFocusId, ...(labelFocusNeighbors ?? [])])
    : null;
  const labelSourceId = labelFocusId
    ? engine.nodes.get(labelFocusId)?.sourceId ?? engine.visualSourceId
    : engine.visualSourceId;
  // DOM labels sit above WebGL. Reserve a small screen-space target around
  // every visible event so an entity card cannot cover the star or steal its
  // hover/click interaction.
  const eventStarRadius = mobile ? 8 : 10;
  const eventStarRects = [...engine.nodes.values()].flatMap((node) => {
    const emergence = engine.nodeEmergence(node);
    if (
      node.kind !== "event"
      || node.sourceId !== labelSourceId
      || emergence.star <= 0.16
      || (node.entryOpacity ?? 1)
        * (node.timelineOpacity ?? 1)
        * currentNodePresentationOpacity(node) <= 0.16
      || !Number.isFinite(node.x)
      || !Number.isFinite(node.y)
      || !Number.isFinite(node.z)
    ) return [];
    const scaledEventStarRadius = eventStarRadius
      * currentNodePresentationScale(node)
      * emergence.starScale
      * (node.temporalPresenceScale ?? 1);
    const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
    const screen = engine.graph.graph2ScreenCoords(node.x, node.y, node.z);
    if (
      projected.z <= -1
      || projected.z >= 1
      || screen.x <= 0
      || screen.x >= width
      || screen.y <= 0
      || screen.y >= height
    ) return [];
    return [{
      nodeId: node.id,
      left: screen.x - scaledEventStarRadius,
      top: screen.y - scaledEventStarRadius,
      right: screen.x + scaledEventStarRadius,
      bottom: screen.y + scaledEventStarRadius,
    }];
  });

  engine.labels.forEach((label) => {
    const node = engine.nodes.get(label.nodeId);
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
      label.element.hidden = true;
      label.element.style.display = "none";
      label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
      return;
    }
    const emergence = engine.nodeEmergence(node);
    const requiredFocusCard = label.kind === "node"
      && Boolean(focusCardIds?.has(node.id));
    const forceCardDetail = overviewCardOverride || requiredFocusCard;
    // Focus may bypass global LOD, never a node's own birth/death. Keeping
    // emergence.card in every branch prevents a selected far package from
    // becoming a fully formed ghost card before its star arrives.
    const nodeCardReveal = emergence.card
      * (forceCardDetail ? 1 : globalCardMorph.reveal);
    const nodeCardScale = forceCardDetail ? 1 : globalCardMorph.scale;
    const depthScale = node.kind === "source" || requiredFocusCard
      ? 1
      : 0.5 + (node.temporalPresenceScale ?? 1) * 0.5;
    const belongsToLabelSource = node.sourceId === labelSourceId;
    const kindPlacementFull = label.kind === "node" && !requiredFocusCard && (
      visibleEventLabels + visibleEntityLabels >= engine.labelPlacementBudget.total
      || (node.kind === "event"
        ? visibleEventLabels >= engine.labelPlacementBudget.events
        : visibleEntityLabels >= engine.labelPlacementBudget.entities)
    );
    if (kindPlacementFull) {
      label.element.hidden = true;
      label.element.style.display = "none";
      label.element.style.pointerEvents = "none";
      label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
      return;
    }
    const sourceHovered = label.kind === "source"
      && !engine.lockedId
      && !engine.selectedId
      && node.id === (engine.keyboardFocusedId ?? engine.hoveredId);
    const belongsToFocusNetwork = !labelFocusId
      ? true
      : Boolean(focusCardIds?.has(node.id));
    // A transient hover must not reflow the board: unrelated cards dim but
    // keep their place, so the eye can keep reading. Only a locked focus
    // (a click — a commitment) clears the stage to its network.
    const layoutOpacity = label.kind === "source"
      ? sourceReveal
      : belongsToLabelSource && belongsToFocusNetwork
        ? nodeCardReveal
        : belongsToLabelSource && transientHover ? nodeCardReveal * 0.35 : 0;
    const dataOpacity = currentNodePresentationOpacity(node)
      * (label.kind === "node" ? engine.nodeAtmosphereOpacity(node) : 1);
    const calculatedOpacity = layoutOpacity * dataOpacity;
    let visibleOpacity = requiredFocusCard
      ? Math.max(0.72 * emergence.card, calculatedOpacity)
      : calculatedOpacity;
    if (visibleOpacity <= 0.01) {
      label.element.hidden = true;
      label.element.style.display = "none";
      label.element.style.pointerEvents = "none";
      label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
      return;
    }
    const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
    const screen = engine.graph.graph2ScreenCoords(node.x, node.y, node.z);
    // Approaching information resolves at the centre, stays readable in the
    // middle field, then loses focus before crossing the viewport edge. A
    // locked network is exempt because its actions must remain dependable.
    const edgeDistance = Math.min(
      screen.x,
      width - screen.x,
      screen.y,
      height - screen.y,
    );
    const edgePresence = label.kind === "node" && !requiredFocusCard
      ? THREE.MathUtils.smoothstep(edgeDistance, 64, 184)
      : 1;
    visibleOpacity *= edgePresence;
    const blurAllowed = !mobile && !engine.reducedMotion;
    const edgeBlur = blurAllowed
      ? (1 - edgePresence) * CARD_DEPTH_BLUR_CSS
      : 0;
    const depthBlur = label.kind === "node"
      && !requiredFocusCard
      && blurAllowed
      ? Math.min(
          CARD_DEPTH_BLUR_CSS,
          emergence.blur * 0.32 + (1 - depthScale) * 2.2,
        )
      : 0;
    const combinedBlur = Math.round(
      Math.max(edgeBlur, depthBlur) * 2,
    ) / 2;
    label.element.style.setProperty(
      "--universe-card-edge-blur",
      `${combinedBlur.toFixed(1)}px`,
    );
    if (visibleOpacity <= 0.01) {
      label.element.hidden = true;
      label.element.style.display = "none";
      label.element.style.pointerEvents = "none";
      label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
      return;
    }
    const nodeAnchorInFrame = projected.z > -1
      && projected.z < 1
      && screen.x > 0
      && screen.x < width
      && screen.y > 0
      && screen.y < height;
    const inFrame = requiredFocusCard
      ? nodeAnchorInFrame
      : projected.z > -1
      && projected.z < 1
      && screen.x > 10
      && screen.x < width - (label.kind === "source" ? 16 : 68)
      && screen.y > (label.kind === "source" ? 48 : 64)
      && screen.y < height - 48;
    if (!inFrame) {
      label.element.hidden = true;
      label.element.style.display = "none";
      label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
      return;
    }

    const emphasized = node.id === (
      engine.lockedId
      ?? engine.selectedId
      ?? engine.keyboardFocusedId
      ?? engine.hoveredId
    );
    const locked = label.kind === "node" && node.id === engine.lockedId;
    const expanded = locked || (node.kind === "event"
      && node.id === labelFocusId
      && !transientHover);
    const compact = label.kind === "node" && node.kind === "entity" && !locked;
    label.element.dataset.locked = String(locked);
    label.element.dataset.expanded = String(expanded);
    label.element.dataset.compact = String(compact);
    // Timeline events arrive in a tight temporal corridor. Give their
    // bounded card set a few screen-space escape routes so overlap guards do
    // not make a full page look like only two or three events were loaded.
    const timelineEventCard = label.kind === "node"
      && node.kind === "event"
      && Boolean(node.sceneNode.timelineBundleId)
      && node.sceneNode.root;
    const distributedCard = requiredFocusCard || timelineEventCard;
    const actions = label.kind === "node"
      ? label.element.querySelector<HTMLElement>("[data-universe-node-actions]")
      : null;
    if (actions) actions.hidden = !locked;
    const sourceBeaconSize = mobile ? 44 : 48;
    const sourceInfoWidth = mobile ? 138 : 154;
    const sourceInfoHeight = mobile ? 40 : 44;
    const sourceInfoGap = 8;
    const baseLabelWidth = label.kind === "source"
      ? sourceBeaconSize
      : locked
        ? mobile ? 224 : 264
      : compact
        ? mobile ? 108 : 132
      : mobile
        ? expanded ? 204 : 184
        : expanded ? 252 : 232;
    const baseLabelHeight = label.kind === "source"
      ? sourceBeaconSize
      : locked
        ? mobile ? 112 : 126
      : compact
        ? mobile ? 24 : 28
      : mobile
        ? expanded ? 82 : 70
        : expanded ? 100 : 86;
    const dataCardScale = label.kind === "source"
      ? 1
      : currentNodePresentationCardScale(node);
    const labelScale = label.kind === "source"
      ? 1
      : nodeCardScale
        * dataCardScale
        * emergence.cardScale
        * depthScale;
    // Reserve the card's final footprint while only its transform grows.
    // Collision choices therefore remain stable through particle → star →
    // card resolution instead of jumping sides as the rectangle expands.
    const layoutScale = label.kind === "source" ? 1 : dataCardScale;
    const labelWidth = baseLabelWidth * layoutScale;
    const labelHeight = baseLabelHeight * layoutScale;
    const labelGap = 3 + layoutScale * 7;
    type LabelSide = "right" | "left" | "top" | "bottom" | "center";
    type LabelRect = {
      left: number;
      top: number;
      right: number;
      bottom: number;
      side: LabelSide;
    };
    const makeRect = (
      left: number,
      top: number,
      rectWidth: number,
      rectHeight: number,
      side: LabelSide,
    ): LabelRect => ({
      left,
      top,
      right: left + rectWidth,
      bottom: top + rectHeight,
      side,
    });
    const sourceMarkerRect = makeRect(
      screen.x - sourceBeaconSize / 2,
      screen.y - sourceBeaconSize / 2,
      sourceBeaconSize,
      sourceBeaconSize,
      "center",
    );
    const focusGapStep = compact
      ? 20
      : Math.min(68, Math.max(36, labelWidth * 0.22));
    const nodeLabelGaps = compact || distributedCard
      ? [
          labelGap,
          labelGap + focusGapStep,
          labelGap + focusGapStep * 2,
        ]
      : [labelGap];
    const nodeCandidates = nodeLabelGaps.flatMap((gap) => [
      makeRect(
        screen.x + gap,
        screen.y - labelHeight / 2,
        labelWidth,
        labelHeight,
        "right",
      ),
      makeRect(
        screen.x - labelWidth - gap,
        screen.y - labelHeight / 2,
        labelWidth,
        labelHeight,
        "left",
      ),
      makeRect(
        screen.x - labelWidth / 2,
        screen.y + gap,
        labelWidth,
        labelHeight,
        "bottom",
      ),
      makeRect(
        screen.x - labelWidth / 2,
        screen.y - labelHeight - gap,
        labelWidth,
        labelHeight,
        "top",
      ),
    ]);
    const candidates: LabelRect[] = label.kind === "source"
      ? sourceHovered
        ? [
            makeRect(
              screen.x - sourceBeaconSize / 2,
              screen.y - sourceBeaconSize / 2,
              sourceBeaconSize + sourceInfoGap + sourceInfoWidth,
              Math.max(sourceBeaconSize, sourceInfoHeight),
              "right",
            ),
            makeRect(
              screen.x - sourceBeaconSize / 2 - sourceInfoGap - sourceInfoWidth,
              screen.y - sourceBeaconSize / 2,
              sourceBeaconSize + sourceInfoGap + sourceInfoWidth,
              Math.max(sourceBeaconSize, sourceInfoHeight),
              "left",
            ),
            makeRect(
              screen.x - sourceInfoWidth / 2,
              screen.y - sourceBeaconSize / 2,
              sourceInfoWidth,
              sourceBeaconSize + sourceInfoGap + sourceInfoHeight,
              "bottom",
            ),
          ]
        : [sourceMarkerRect]
      : nodeCandidates;
    if (label.kind === "node" && screen.x >= width / 2) {
      [candidates[0], candidates[1]] = [candidates[1], candidates[0]];
    }
    const blockedByViewportOrPanel = (rect: LabelRect) => {
      const outside = rect.left < 10
        || rect.right > width - 10
        || rect.top < 58
        || rect.bottom > height - 42;
      const overlapsPanel = [
        panelRect,
        summaryRect,
        progressRect,
      ].some((overlay) => overlay
        ? rect.left < overlay.right
          && rect.right > overlay.left
          && rect.top < overlay.bottom
          && rect.bottom > overlay.top
        : false);
      return outside || overlapsPanel;
    };
    const overlapsPlacedLabel = (rect: LabelRect) => placed.some((other) =>
      rect.left < other.right + 7
      && rect.right > other.left - 7
      && rect.top < other.bottom + 6
      && rect.bottom > other.top - 6);
    const overlapsEventStar = (rect: LabelRect) => label.kind === "node"
      && eventStarRects.some((star) => star.nodeId !== label.nodeId
        && rect.left < star.right
        && rect.right > star.left
        && rect.top < star.bottom
        && rect.bottom > star.top);
    const clampedCandidates = requiredFocusCard
      ? candidates.map((candidate) => {
          const maxLeft = Math.max(10, width - labelWidth - 10);
          const maxTop = Math.max(58, height - labelHeight - 42);
          return makeRect(
            THREE.MathUtils.clamp(candidate.left, 10, maxLeft),
            THREE.MathUtils.clamp(candidate.top, 58, maxTop),
            labelWidth,
            labelHeight,
            candidate.side,
          );
        })
      : [];
    const isOpenPlacement = (candidate: LabelRect) =>
      !blockedByViewportOrPanel(candidate)
      && !overlapsPlacedLabel(candidate)
      && !overlapsEventStar(candidate);
    const rect = candidates.find(isOpenPlacement)
      ?? clampedCandidates.find(isOpenPlacement)
      ?? (requiredFocusCard || emphasized
        ? [...clampedCandidates, ...candidates]
            .find((candidate) => !blockedByViewportOrPanel(candidate))
          ?? clampedCandidates[0]
          ?? candidates[0]
        : null);
    if (!rect) {
      label.element.hidden = true;
      label.element.style.display = "none";
      label.element.style.pointerEvents = "none";
      label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
      return;
    }
    label.element.hidden = false;
    label.element.style.display = "flex";
    label.element.dataset.side = rect.side;
    label.element.dataset.hovered = String(sourceHovered);
    label.element.dataset.highlighted = String(emphasized || engine.sourceHits.some(
      (hit) => hit.source_id === node.sourceId,
    ));
    const baseLabelOpacity = visibleOpacity * (
      emphasized ? 1 : label.kind === "source" ? 0.94 : 0.84
    );
    label.element.dataset.baseOpacity = baseLabelOpacity.toFixed(3);
    label.element.style.opacity = String(
      baseLabelOpacity * hoverLabelOpacityFactor(engine, node),
    );
    label.element.style.pointerEvents = label.kind === "source"
      ? visibleOpacity >= 0.58 ? "auto" : "none"
      : nodeCardReveal >= 0.72 && visibleOpacity >= 0.22 ? "auto" : "none";
    label.element.style.zIndex = emphasized ? "4" : label.kind === "node" ? "2" : "1";
    if (label.kind === "source") {
      label.element.style.transformOrigin = "center";
      label.element.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) translate(-50%, -50%)`;
    } else {
      const connectorLength = rect.side === "right"
        ? rect.left - screen.x
        : rect.side === "left"
          ? screen.x - rect.right
          : rect.side === "bottom"
            ? rect.top - screen.y
            : screen.y - rect.bottom;
      label.element.style.setProperty(
        "--universe-label-connector-length",
        `${Math.max(10, connectorLength).toFixed(1)}px`,
      );
      let translateX = rect.left;
      let translateY = rect.top;
      if (rect.side === "right") {
        label.element.style.transformOrigin = "left center";
        translateY -= (baseLabelHeight - labelHeight) / 2;
      } else if (rect.side === "left") {
        label.element.style.transformOrigin = "right center";
        translateX -= baseLabelWidth - labelWidth;
        translateY -= (baseLabelHeight - labelHeight) / 2;
      } else if (rect.side === "bottom") {
        label.element.style.transformOrigin = "center top";
        translateX -= (baseLabelWidth - labelWidth) / 2;
      } else {
        label.element.style.transformOrigin = "center bottom";
        translateX -= (baseLabelWidth - labelWidth) / 2;
        translateY -= baseLabelHeight - labelHeight;
      }
      label.element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${labelScale})`;
    }
    if (visibleOpacity >= 0.22) placed.push(rect);
    if (label.kind === "node") {
      if (node.kind === "event") visibleEventLabels += 1;
      else visibleEntityLabels += 1;
    }
  });
  engine.host.dataset.universeEventLabelCount = String(visibleEventLabels);
  engine.host.dataset.universeEntityLabelCount = String(visibleEntityLabels);
}

// 局部变量与函数同名时的调用别名(遮蔽规避)
const resolveLabelFocusId = labelFocusId;
