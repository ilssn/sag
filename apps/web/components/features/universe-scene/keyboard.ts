"use client";

/**
 * 键盘导航子系统（自 universe-scene-engine 拆出）。
 * 焦点推进/清除、候选排序与无障碍状态播报;宿主为引擎实例。
 */

import * as THREE from "three";
import { currentNodePresentationOpacity } from "./internals";
import { orderUniverseKeyboardCandidates } from "@/lib/universe";
import type { ForceNode } from "./engine";
import type { UniverseForceSceneEngine as Engine } from "./engine";

export function keyboardCandidates(engine: Engine) {
  const detailSourceId = engine.visualDetailMix >= 0.5 ? engine.visualSourceId : null;
  const camera = engine.graph.camera();
  camera.updateMatrixWorld();
  const width = Math.max(1, engine.host.clientWidth);
  const height = Math.max(1, engine.host.clientHeight);
  const inViewport = (node: ForceNode) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
      return false;
    }
    const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
    const screen = engine.graph.graph2ScreenCoords(node.x, node.y, node.z);
    return projected.z > -1
      && projected.z < 1
      && screen.x >= 0
      && screen.x <= width
      && screen.y >= 0
      && screen.y <= height;
  };
  const candidates = [...engine.nodes.values()].filter((node) => {
    if (
      (node.entryOpacity ?? 1)
        * (node.timelineOpacity ?? 1)
        * currentNodePresentationOpacity(node) <= 0.12
    ) return false;
    if (node.kind !== "source" && engine.nodeEmergence(node).star < 0.72) {
      return false;
    }
    if (!inViewport(node)) return false;
    if (!detailSourceId) return true;
    return node.kind !== "source"
      && node.sourceId === detailSourceId;
  });
  const candidatesById = new Map(candidates.map((node) => [node.id, node]));
  return orderUniverseKeyboardCandidates(candidates.map((node) => ({
    id: node.id,
    sourceId: node.sourceId,
    kind: node.kind,
    root: node.sceneNode.root,
    importance: node.sceneNode.importance,
  }))).map((candidate) => candidatesById.get(candidate.id) as ForceNode);
}

export function updateKeyboardStatus(engine: Engine, candidates = keyboardCandidates(engine)) {
  const node = engine.keyboardFocusedId
    ? engine.nodes.get(engine.keyboardFocusedId)
    : undefined;
  const index = node ? candidates.findIndex((candidate) => candidate.id === node.id) : -1;
  engine.host.dataset.universeKeyboardCandidateCount = String(candidates.length);
  engine.host.dataset.universeKeyboardIndex = index >= 0 ? String(index + 1) : "";
  if (!node || index < 0) {
    engine.keyboardStatusElement.textContent = "";
    return;
  }
  const label = node.kind === "source"
    ? engine.text.exploreSource(node.sceneNode.label)
    : engine.text.exploreNode(node.kind, node.sceneNode.label);
  engine.keyboardStatusElement.textContent = engine.text.keyboardStatus(
    label,
    index + 1,
    candidates.length,
  );
}

export function clearKeyboardFocus(engine: Engine, notify = true, refresh = true) {
  if (!engine.keyboardFocusedId) {
    updateKeyboardStatus(engine, []);
    return;
  }
  engine.keyboardFocusedId = null;
  engine.host.dataset.universeKeyboardNodeId = "";
  updateKeyboardStatus(engine, []);
  if (notify) engine.callbacks.onHover(null);
  if (!refresh || !engine.dataReady) return;
  engine.applyHighlight();
  engine.scheduleHoverLabelRebuild(true);
}

export function setKeyboardFocus(engine: Engine, nodeId: string, candidates: ForceNode[]) {
  const node = engine.nodes.get(nodeId);
  if (!node) return;
  engine.cancelHoverClear();
  engine.hoveredId = null;
  engine.hoveredFromLabel = false;
  engine.keyboardFocusedId = nodeId;
  engine.host.dataset.universeKeyboardNodeId = nodeId;
  engine.wakeRendering(700);
  engine.applyHighlight();
  engine.scheduleHoverLabelRebuild(true);
  updateKeyboardStatus(engine, candidates);
  const screen = engine.graph.graph2ScreenCoords(node.x, node.y, node.z);
  const hostRect = engine.host.getBoundingClientRect();
  engine.callbacks.onHover({
    node: node.sceneNode,
    x: hostRect.left + screen.x,
    y: hostRect.top + screen.y,
  });
}
