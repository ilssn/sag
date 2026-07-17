"use client";

/**
 * 知识宇宙场景内部共享工具（引擎与各子系统模块共用的纯层）。
 * 稳定哈希、呈现比例/透明度换算 —— 全部为无副作用纯函数。
 */

import * as THREE from "three";

import type { ForceNode } from "@/components/features/universe-scene-engine";

export const WHITE = new THREE.Color("#ffffff");

export function stableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function presentationScale(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 1;
}

export function presentationOpacity(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, 0, 1)
    : 1;
}

export function currentNodePresentationScale(node: ForceNode) {
  return node.presentationScale ?? presentationScale(node.sceneNode.presentationScale);
}

export function currentNodePresentationCardScale(node: ForceNode) {
  return node.presentationCardScale
    ?? presentationScale(node.sceneNode.presentationCardScale);
}

export function currentNodePresentationOpacity(node: ForceNode) {
  return node.presentationOpacity ?? presentationOpacity(node.sceneNode.presentationOpacity);
}
