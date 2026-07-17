"use client";

/**
 * 指针视差子系统（自 universe-scene-engine 拆出）。
 * 浏览态相机的微视差与凝视回正；宿主为引擎实例（状态仍归引擎所有）。
 */

import * as THREE from "three";
import type { UniverseForceSceneEngine as Engine } from "./universe-scene-engine";

const BROWSE_PARALLAX_X = 12;

const BROWSE_PARALLAX_Y = 7;

const BROWSE_PARALLAX_RESPONSE = 0.055;

export function updatePointerParallax(engine: Engine) {
  const target = engine.controls.target;
  if (!target) return false;
  const width = Math.max(1, engine.host.clientWidth);
  const height = Math.max(1, engine.host.clientHeight);
  const active = engine.browseGazeApplied
    && !engine.reducedMotion
    && engine.pointerActive
    && !engine.paused;
  const ndcX = THREE.MathUtils.clamp((engine.pointerX / width - 0.5) * 2, -1, 1);
  const ndcY = THREE.MathUtils.clamp((engine.pointerY / height - 0.5) * 2, -1, 1);
  const desiredX = active ? ndcX * BROWSE_PARALLAX_X : 0;
  const desiredY = active ? -ndcY * BROWSE_PARALLAX_Y : 0;
  const nextX = THREE.MathUtils.lerp(
    engine.parallaxApplied.x,
    desiredX,
    BROWSE_PARALLAX_RESPONSE,
  );
  const nextY = THREE.MathUtils.lerp(
    engine.parallaxApplied.y,
    desiredY,
    BROWSE_PARALLAX_RESPONSE,
  );
  const dx = nextX - engine.parallaxApplied.x;
  const dy = nextY - engine.parallaxApplied.y;
  if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) return false;
  engine.parallaxApplied = { x: nextX, y: nextY };
  const camera = engine.graph.camera();
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  target.addScaledVector(right, dx).addScaledVector(up, dy);
  return true;
}

/**
 * Camera-relative presence along the flight axis. Whatever the camera
 * reaches is fully present; ahead thins atmospherically toward a visible
 * floor, behind fades out. This is the moving-camera replacement for static
 * age-based dimming, which would leave a reached package forever dark.
 */
