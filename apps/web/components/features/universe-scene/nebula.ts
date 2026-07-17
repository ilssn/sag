"use client";

/**
 * 星云子系统（自 universe-scene-engine 拆出）。
 * 走廊尘埃重建、位置/透明度上传、环境呼吸与相机静默判定;宿主为引擎实例。
 */

import * as THREE from "three";

import {
  NEBULA_BRAND_GOLD,
  NEBULA_CORRIDOR_BAND_OFF,
  NEBULA_CORRIDOR_WRAP_SPAN,
  NEBULA_DETAIL_ALPHA,
  makeNebulaMaterial,
} from "./textures";
import { WHITE, stableUnit } from "./internals";
import {
  UNIVERSE_TEMPORAL_AXIS_FAR_LATERAL_SPREAD,
  UNIVERSE_TEMPORAL_AXIS_NEAR_LATERAL_SPREAD,
  UNIVERSE_TEMPORAL_AXIS_UNITS_PER_EVENT,
  UNIVERSE_TEMPORAL_AXIS_VERTICAL_ASPECT,
} from "@/lib/universe";
import type { NebulaParticle } from "./engine";
import type { UniverseForceSceneEngine as Engine } from "./engine";

export const NEBULA_AMBIENT_MOTION_MS = 5_000;

const NEBULA_AMBIENT_FRAME_MS_DESKTOP = 1000 / 24;

const NEBULA_AMBIENT_FRAME_MS_MOBILE = 1000 / 18;

export const NEBULA_SOURCE_RADIUS_MIN = 88;

export const NEBULA_SOURCE_RADIUS_SCALE = 2.25;

const NEBULA_SOURCE_CORRIDOR_SCALE = 2.35;

const NEBULA_CORRIDOR_NEAR_SPREAD = UNIVERSE_TEMPORAL_AXIS_NEAR_LATERAL_SPREAD;

const NEBULA_CORRIDOR_FAR_SPREAD = UNIVERSE_TEMPORAL_AXIS_FAR_LATERAL_SPREAD;

const NEBULA_CORRIDOR_VERTICAL_ASPECT = UNIVERSE_TEMPORAL_AXIS_VERTICAL_ASPECT;

const NEBULA_WALL_SHARE = 0.46;

const NEBULA_WALL_LATERAL_MIN = 1.6;

const NEBULA_WALL_LATERAL_MAX = 3.8;

export function rebuildNebula(engine: Engine) {
  const sources = engine.sourceNodeList;
  const mobile = engine.host.clientWidth < 768;
  const configuredBudget = mobile
    ? engine.policy.proxy_budget_mobile
    : engine.policy.proxy_budget_desktop;
  const budgetCap = mobile ? 4_000 : 16_000;
  const budget = Math.min(
    budgetCap,
    Math.max(0, Number.isFinite(configuredBudget) ? configuredBudget : 0),
  );
  engine.host.dataset.universeNebulaConfiguredBudget = String(configuredBudget);
  engine.host.dataset.universeNebulaBudgetCap = String(budgetCap);
  engine.host.dataset.universeNebulaBudget = String(budget);
  // One stable particle field owns the entire overview → source → corridor
  // journey. Selection must never reassign six times as many grains to one
  // source: that made the entrance look like a particle explosion instead
  // of the existing galaxy naturally opening into data.
  const signature = `${mobile ? "mobile" : "desktop"}:${budget}:` + sources
    .map((node) => `${node.id}:${Math.round(node.sceneNode.radius)}:${node.sceneNode.eventCount}:${node.sceneNode.entityCount}`)
    .join("|");
  if (signature === engine.sourceSignature && engine.nebulaPoints) {
    updateNebulaPositions(engine);
    updateNebulaAlphas(engine);
    return;
  }
  engine.sourceSignature = signature;
  clearNebula(engine);
  if (!sources.length) return;
  engine.nebulaSourceIndices = new Map(
    sources.map((source, index) => [source.sourceId, index]),
  );
  const weights = sources.map((source) =>
    Math.max(1, Math.log2(source.sceneNode.eventCount + source.sceneNode.entityCount + 2)),
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const baseCount = Math.max(
    0,
    Math.min(mobile ? 10 : 14, Math.floor(budget / Math.max(1, sources.length))),
  );
  const weightedBudget = Math.max(0, budget - baseCount * sources.length);
  const particles: NebulaParticle[] = [];
  const spinAxesBySource = new Map<string, THREE.Vector3>();
  const spinRatesBySource = new Map<string, number>();
  sources.forEach((source, sourceIndex) => {
    const count = baseCount + Math.floor(
      (weightedBudget * weights[sourceIndex]) / Math.max(1, totalWeight),
    );
    // A bounded spiral nebula, not a flat plate and not random point fog.
    // Tight arm lanes make the silhouette readable from the overview; real
    // z-thickness and restrained inter-arm dust keep the approach spatial.
    const radius = Math.max(
      NEBULA_SOURCE_RADIUS_MIN,
      source.sceneNode.radius * NEBULA_SOURCE_RADIUS_SCALE,
    );
    const tiltDirection = stableUnit(`${source.id}:tilt-direction`) < 0.5 ? -1 : 1;
    const rotation = new THREE.Euler(
      THREE.MathUtils.degToRad(
        (52 + stableUnit(`${source.id}:tilt`) * 16) * tiltDirection,
      ),
      THREE.MathUtils.degToRad(
        (stableUnit(`${source.id}:yaw`) - 0.5) * 24,
      ),
      stableUnit(`${source.id}:roll`) * Math.PI * 2,
      "ZXY",
    );
    spinAxesBySource.set(
      source.sourceId,
      new THREE.Vector3(0, 0, 1).applyEuler(rotation).normalize(),
    );
    const spinDirection = stableUnit(`${source.id}:spin-direction`) < 0.5 ? -1 : 1;
    spinRatesBySource.set(
      source.sourceId,
      (0.007 + stableUnit(`${source.id}:spin-rate`) * 0.0045) * spinDirection,
    );
    const armCount = 2 + Math.floor(stableUnit(`${source.id}:arm-count`) * 2);
    const winding = Math.PI * (
      2.65 + stableUnit(`${source.id}:arm-winding`) * 0.7
    );
    for (let index = 0; index < count; index += 1) {
      const key = `${source.id}:dust:${index}`;
      const population = stableUnit(`${key}:population`);
      const coreParticle = population < 0.3;
      const haloParticle = population >= 0.92;
      const diffuseParticle = population >= 0.72 && !haloParticle;
      const phase = stableUnit(`${key}:phase`) * Math.PI * 2;
      const radial = haloParticle
        ? 0.78 + Math.pow(stableUnit(`${key}:radius`), 0.8) * 0.38
        : Math.pow(
            stableUnit(`${key}:radius`),
            coreParticle ? 3.05 : diffuseParticle ? 0.74 : 0.64,
          );
      const armIndex = Math.min(
        armCount - 1,
        Math.floor(stableUnit(`${key}:arm-index`) * armCount),
      );
      const laneSeed = stableUnit(`${key}:arm-lane`) * 2 - 1;
      const laneWidth = coreParticle
        ? 1.05
        : haloParticle
          ? Math.PI
        : diffuseParticle
          ? 1.15
          : 0.17 + radial * 0.24;
      const laneOffset = Math.sign(laneSeed)
        * Math.pow(Math.abs(laneSeed), 1.75)
        * laneWidth;
      const angle = haloParticle
        ? stableUnit(`${key}:halo-angle`) * Math.PI * 2
        : (armIndex / armCount) * Math.PI * 2
          + radial * winding
          + laneOffset;
      const planarRadius = radius * Math.min(1.16, radial);
      const thickness = radius
        * (coreParticle ? 0.2 : haloParticle ? 0.12 : diffuseParticle ? 0.11 : 0.085)
        * (1 - radial * 0.32);
      const offset = new THREE.Vector3(
        Math.cos(angle) * planarRadius * 1.08,
        Math.sin(angle) * planarRadius * 0.92,
        (stableUnit(`${key}:depth`) * 2 - 1) * thickness
          + Math.sin(angle * 1.8 + phase) * radius * 0.045 * (1 - radial),
      );
      offset.applyEuler(rotation);
      const twinkle = Math.pow(stableUnit(`${key}:twinkle`), 1.18);
      const glowSeed = stableUnit(`${key}:glow`);
      const emitterParticle = coreParticle
        ? stableUnit(`${key}:emitter`) < 0.18
        : stableUnit(`${key}:emitter`) < 0.025;
      // Sparse light pockets punctuate fine grain; no oversized fog blobs.
      const glowChance = coreParticle ? 0.018 : 0.006;
      particles.push({
        sourceId: source.sourceId,
        sourceIndex,
        offset,
        core: coreParticle,
        emitter: emitterParticle,
        radial: Math.min(1, radial),
        alpha: haloParticle
          ? 0.05 + stableUnit(`${key}:alpha`) * 0.11
          : diffuseParticle
          ? 0.12 + stableUnit(`${key}:alpha`) * 0.2
          : (coreParticle ? 0.58 : 0.32)
            + stableUnit(`${key}:alpha`) * (coreParticle ? 0.42 : 0.54),
        glow: glowSeed < glowChance
          ? 0.5 + stableUnit(`${key}:glow-strength`) * 0.32
          : 0,
        phase,
        twinkle,
      });
    }
  });
  engine.host.dataset.universeParticleCount = String(particles.length);
  engine.nebulaParticles = particles;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particles.length * 3);
  const corridors = new Float32Array(particles.length * 3);
  const colors = new Float32Array(particles.length * 3);
  const alphas = new Float32Array(particles.length);
  const sourceIndices = new Float32Array(particles.length);
  const sourceCenters = new Float32Array(particles.length * 3);
  const spinAxes = new Float32Array(particles.length * 3);
  const visuals = new Float32Array(particles.length * 4);
  const motions = new Float32Array(particles.length * 4);
  const axisDepthBySource = new Map(sources.map((source) => [
    source.sourceId,
    Math.max(0, source.sceneNode.eventCount - 1)
      * UNIVERSE_TEMPORAL_AXIS_UNITS_PER_EVENT,
  ]));
  const lateralBySource = new Map(sources.map((source) => [
    source.sourceId,
    Math.max(96, source.sceneNode.radius) * NEBULA_SOURCE_CORRIDOR_SCALE,
  ]));
  particles.forEach((particle, index) => {
    // The cloud previews the graph before any card exists: gold grains are
    // future event stars; accent grains are future entities. Because the
    // same particles become the corridor, this semantic colour continuity
    // survives the entire outside → inside → graph transition.
    const eventGrain = stableUnit(`${particle.sourceId}:${index}:semantic`)
      < (particle.core ? 0.48 : 0.36);
    const color = eventGrain
      ? NEBULA_BRAND_GOLD.clone()
      : engine.sourceVisualColor(particle.sourceId);
    const whiteMix = particle.core
      ? 0.08 + (1 - particle.radial) * 0.18
      : stableUnit(`${particle.sourceId}:${index}:white`)
        * (engine.darkTheme ? 0.07 : 0.05);
    color.lerp(WHITE, whiteMix);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    // Brand grain: fine dust, a denser bright heart carried by size too.
    const visualOffset = index * 4;
    visuals[visualOffset] = 0.95
      + stableUnit(`${particle.sourceId}:${index}:size`) * 2.2
      + (particle.twinkle > 0.8 ? 0.6 : 0)
      + (eventGrain ? 0.16 : 0)
      + (particle.core ? (1 - particle.radial) * 0.8 : 0);
    alphas[index] = particle.alpha;
    visuals[visualOffset + 1] = particle.glow;
    visuals[visualOffset + 2] = particle.glow === 0
      && (particle.twinkle > 0.9 || (eventGrain && particle.twinkle > 0.66))
      ? 1
      : 0;
    visuals[visualOffset + 3] = 0.18 + particle.twinkle * 0.82;
    sourceIndices[index] = particle.sourceIndex;
    const source = sources[particle.sourceIndex];
    const spinAxis = spinAxesBySource.get(particle.sourceId)
      ?? new THREE.Vector3(0, 0, 1);
    sourceCenters[index * 3] = source?.x ?? 0;
    sourceCenters[index * 3 + 1] = source?.y ?? 0;
    sourceCenters[index * 3 + 2] = source?.z ?? 0;
    spinAxes[index * 3] = spinAxis.x;
    spinAxes[index * 3 + 1] = spinAxis.y;
    spinAxes[index * 3 + 2] = spinAxis.z;
    motions[visualOffset] = particle.phase;
    motions[visualOffset + 1] = spinRatesBySource.get(particle.sourceId) ?? 0.008;
    motions[visualOffset + 2] = particle.emitter ? 1 : 0;
    // The corridor form: the same dust, laid out along ONE wrap span of the
    // counting axis. The shader repeats it modulo the span around the
    // flight depth, so a fixed budget gives the same density beside the
    // camera whether the source holds 12 events or 5,000.
    const key = `${particle.sourceId}:corridor:${index}`;
    const axisDepth = axisDepthBySource.get(particle.sourceId) ?? 0;
    const depth = stableUnit(`${key}:depth`)
      * Math.min(Math.max(1, axisDepth), NEBULA_CORRIDOR_WRAP_SPAN);
    // Two shells: sparse wisps you fly through, and the canyon walls — a
    // fine star field framing the corridor, far enough to barely parallax
    // under a gaze turn but near enough to live inside the field of view.
    const wall = !particle.emitter
      && particle.glow === 0
      && stableUnit(`${key}:shell`) < NEBULA_WALL_SHARE;
    const lateralScale = wall
      ? NEBULA_WALL_LATERAL_MIN
        + stableUnit(`${key}:wall-radius`)
          * (NEBULA_WALL_LATERAL_MAX - NEBULA_WALL_LATERAL_MIN)
      : 0.35 + stableUnit(`${key}:radius`) * 0.85;
    // A stable per-particle radius seed: under the camera wrap a particle's
    // distance keeps changing, so the cross-section is a textured tube, not
    // a cone that could saw-tooth at the wrap boundary.
    const lateral = (NEBULA_CORRIDOR_NEAR_SPREAD
      + (NEBULA_CORRIDOR_FAR_SPREAD - NEBULA_CORRIDOR_NEAR_SPREAD)
        * stableUnit(`${key}:spread`))
      * (lateralBySource.get(particle.sourceId) ?? 130)
      * lateralScale;
    const angle = stableUnit(`${key}:angle`) * Math.PI * 2;
    motions[visualOffset + 3] = wall ? 1 : 0;
    corridors[index * 3] = Math.cos(angle) * lateral - particle.offset.x;
    corridors[index * 3 + 1] = Math.sin(angle) * lateral
      * NEBULA_CORRIDOR_VERTICAL_ASPECT - particle.offset.y;
    corridors[index * 3 + 2] = -depth - particle.offset.z;
  });
  const positionAttribute = new THREE.BufferAttribute(positions, 3)
    .setUsage(THREE.DynamicDrawUsage);
  const alphaAttribute = new THREE.BufferAttribute(alphas, 1)
    .setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("aCorridor", new THREE.BufferAttribute(corridors, 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aVisual", new THREE.BufferAttribute(visuals, 4));
  geometry.setAttribute("aMotion", new THREE.BufferAttribute(motions, 4));
  geometry.setAttribute("aAlpha", alphaAttribute);
  geometry.setAttribute("aSourceIndex", new THREE.BufferAttribute(sourceIndices, 1));
  geometry.setAttribute("aSourceCenter", new THREE.BufferAttribute(sourceCenters, 3));
  geometry.setAttribute("aSpinAxis", new THREE.BufferAttribute(spinAxes, 3));
  engine.nebulaPoints = new THREE.Points(geometry, makeNebulaMaterial(engine.darkTheme));
  engine.nebulaPoints.name = "sag-source-nebulae";
  engine.nebulaPoints.frustumCulled = false;
  engine.graph.scene().add(engine.nebulaPoints);
  engine.updatePixelRatio();
  updateNebulaPositions(engine);
  updateNebulaAlphas(engine, true);
  syncNebulaCorridorUniforms(engine);
  updateNebulaMotionState(engine);
  armNebulaAnimation(engine);
}

/**
 * Clamps rotation to a forward gaze cone while browsing: a bounded glance
 * around the corridor, never an orbit that flips the nebula over. The axis
 * is world-aligned, so azimuth 0 already faces down the corridor.
 */

export function syncNebulaCorridorUniforms(engine: Engine) {
  const material = engine.nebulaPoints?.material as THREE.ShaderMaterial | undefined;
  if (!material) return;
  const config = engine.flightConfig;
  material.uniforms.uCorridorNearZ.value = config
    ? config.centerZ - config.windowNearDepth
    : NEBULA_CORRIDOR_BAND_OFF;
  material.uniforms.uCorridorFarZ.value = config
    ? config.centerZ - config.windowFarDepth
    : NEBULA_CORRIDOR_BAND_OFF;
  // The dust wrap re-anchors to wherever the camera is on the axis, so it
  // must ride the flight depth every frame it changes.
  material.uniforms.uFlightDepth.value = config ? engine.appliedFlightDepth : 0;
  material.uniforms.uCorridorAxisDepth.value = config
    ? Math.max(0, config.maxDepth)
    : 0;
  material.uniforms.uCorridorCenterZ.value = config ? config.centerZ : 0;
  material.uniforms.uCorridorVestibule.value = config
    ? Math.max(0, config.vestibuleDepth)
    : 0;
}

export function updateNebulaPositions(engine: Engine) {
  if (!engine.nebulaPoints) return;
  const position = engine.nebulaPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
  const sourceCenter = engine.nebulaPoints.geometry.getAttribute(
    "aSourceCenter",
  ) as THREE.BufferAttribute;
  engine.nebulaParticles.forEach((particle, index) => {
    const source = engine.sourceNodesById.get(particle.sourceId);
    if (!source) return;
    position.setXYZ(
      index,
      source.x + particle.offset.x,
      source.y + particle.offset.y,
      source.z + particle.offset.z,
    );
    sourceCenter.setXYZ(index, source.x, source.y, source.z);
  });
  position.needsUpdate = true;
  sourceCenter.needsUpdate = true;
}

export function updateNebulaAlphas(engine: Engine, force = false) {
  if (!engine.nebulaPoints) return;
  const material = engine.nebulaPoints.material as THREE.ShaderMaterial;
  material.uniforms.uDetail.value = engine.visualDetailMix;
  material.uniforms.uDetailSource.value = engine.visualSourceId
    ? engine.nebulaSourceIndices.get(engine.visualSourceId) ?? -1
    : -1;
  const detailFactor = THREE.MathUtils.lerp(
    1,
    NEBULA_DETAIL_ALPHA,
    THREE.MathUtils.smoothstep(engine.visualDetailMix, 0.18, 0.78),
  );
  engine.host.dataset.universeNebulaDetailFactor = detailFactor.toFixed(2);
  engine.host.dataset.universeNebulaAlphaMode = "gpu-detail";
  const persistentAnchor = engine.nodes.get(
    engine.lockedId ?? engine.selectedId ?? engine.keyboardFocusedId ?? "",
  );
  // Source hover and source entry share the shader's continuous focus morph.
  // Rewriting every particle alpha on pointer exit made the selected galaxy
  // dim once while every background galaxy flashed before fading again.
  const anchor = persistentAnchor;
  const contextKey = anchor
    ? `anchor:${anchor.kind}:${anchor.sourceId}`
    : engine.sourceHits.length
      ? `hits:${engine.sourceHits.map((hit) => hit.source_id).join("|")}`
      : "default";
  const modeKey = contextKey;
  if (!force && modeKey === engine.nebulaAlphaKey) return;
  engine.nebulaAlphaKey = modeKey;
  const alpha = engine.nebulaPoints.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
  const hitRank = new Map(engine.sourceHits.map((hit, index) => [hit.source_id, index]));
  // Context changes are rare CPU buffer updates. The source-detail morph is
  // handled continuously by shader uniforms above, avoiding repeated uploads
  // of the full alpha attribute while the camera moves into a nebula.
  engine.nebulaParticles.forEach((particle, index) => {
    let multiplier = 1;
    if (anchor?.kind === "source") {
      multiplier = anchor.sourceId === particle.sourceId ? 1.28 : 0.14;
    } else if (anchor) {
      multiplier = anchor.sourceId === particle.sourceId ? 0.76 : 0.08;
    }
    else if (hitRank.size) {
      const rank = hitRank.get(particle.sourceId);
      multiplier = rank === 0 ? 1 : rank !== undefined ? 0.52 : 0.12;
    }
    alpha.setX(index, particle.alpha * multiplier);
  });
  alpha.needsUpdate = true;
  engine.nebulaAlphaUploads += 1;
  engine.host.dataset.universeNebulaAlphaUploads = String(engine.nebulaAlphaUploads);
}

export function nebulaMotionStrength(engine: Engine) {
  if (
    !engine.nebulaPoints
    || !engine.interactive
    || engine.reducedMotion
    || engine.reportedViewSourceId
    || performance.now() < engine.cameraCalmUntil
    || document.visibilityState !== "visible"
  ) return 0;
  return THREE.MathUtils.clamp((0.52 - engine.visualDetailMix) / 0.22, 0, 1);
}

export function nebulaAmbientEligible(engine: Engine) {
  return Boolean(
    engine.nebulaPoints
    && engine.interactive
    && !engine.paused
    && !engine.reducedMotion
    && !engine.reportedViewSourceId
    && engine.visualDetailMix < 0.52
    && document.visibilityState === "visible"
  );
}

export function shouldAnimateNebula(engine: Engine) {
  return nebulaAmbientEligible(engine) && nebulaMotionStrength(engine) > 0.01;
}

export function stopNebulaAmbientTicker(engine: Engine) {
  if (engine.nebulaAmbientTimer !== null) {
    window.clearInterval(engine.nebulaAmbientTimer);
    engine.nebulaAmbientTimer = null;
  }
  engine.lastNebulaAnimationAt = 0;
}

export function syncNebulaAmbientTicker(engine: Engine) {
  if (!nebulaAmbientEligible(engine)) {
    stopNebulaAmbientTicker(engine);
    return;
  }
  if (engine.nebulaAmbientTimer !== null) return;
  const interval = engine.host.clientWidth < 768
    ? NEBULA_AMBIENT_FRAME_MS_MOBILE
    : NEBULA_AMBIENT_FRAME_MS_DESKTOP;
  engine.nebulaAmbientTimer = window.setInterval(() => {
    if (!nebulaAmbientEligible(engine)) {
      stopNebulaAmbientTicker(engine);
      return;
    }
    updateNebulaAnimation(engine, performance.now());
  }, interval);
}

export function armNebulaAnimation(engine: Engine, duration = NEBULA_AMBIENT_MOTION_MS) {
  if (engine.paused || !nebulaAmbientEligible(engine)) return;
  updateNebulaMotionState(engine);
  engine.wakeRendering(Math.min(duration + 120, 1_200));
  engine.startLoop(Math.min(duration + 120, 900));
}

export function updateNebulaMotionState(engine: Engine) {
  const strength = nebulaMotionStrength(engine);
  const active = shouldAnimateNebula(engine);
  engine.host.dataset.universeNebulaMotion = active ? "active" : "idle";
  syncNebulaAmbientTicker(engine);
  if (!engine.nebulaPoints) return;
  const material = engine.nebulaPoints.material as THREE.ShaderMaterial;
  material.uniforms.uMotion.value = strength;
}

export function updateNebulaAnimation(engine: Engine, now: number) {
  const strength = nebulaMotionStrength(engine);
  const active = shouldAnimateNebula(engine);
  if (!engine.nebulaPoints) return false;
  const material = engine.nebulaPoints.material as THREE.ShaderMaterial;
  material.uniforms.uMotion.value = strength;
  if (!active) {
    engine.host.dataset.universeNebulaMotion = "idle";
    return false;
  }
  engine.host.dataset.universeNebulaMotion = "active";
  const frameInterval = engine.host.clientWidth < 768
    ? NEBULA_AMBIENT_FRAME_MS_MOBILE
    : NEBULA_AMBIENT_FRAME_MS_DESKTOP;
  if (now - engine.lastNebulaAnimationAt >= frameInterval) {
    const elapsed = engine.lastNebulaAnimationAt > 0
      ? Math.min(100, now - engine.lastNebulaAnimationAt)
      : 0;
    engine.lastNebulaAnimationAt = now;
    engine.nebulaAnimationElapsed += elapsed / 1000;
    material.uniforms.uTime.value = engine.nebulaAnimationElapsed;
    if (!engine.renderingAwake) {
      engine.graph.renderer().render(engine.graph.scene(), engine.graph.camera());
    }
  }
  // A dedicated low-frequency ticker owns ambient overview motion. The main
  // interaction loop can therefore sleep instead of polling at display Hz.
  return active && engine.nebulaAmbientTimer === null;
}

export function clearNebula(engine: Engine) {
  engine.nebulaParticles = [];
  engine.nebulaSourceIndices.clear();
  engine.nebulaAlphaKey = "";
  engine.nebulaAlphaUploads = 0;
  stopNebulaAmbientTicker(engine);
  engine.nebulaAnimationElapsed = 0;
  engine.host.dataset.universeNebulaMotion = "idle";
  engine.host.dataset.universeNebulaAlphaUploads = "0";
  engine.host.dataset.universeParticleCount = "0";
  if (!engine.nebulaPoints) {
    return;
  }
  engine.graph.scene().remove(engine.nebulaPoints);
  engine.nebulaPoints.geometry.dispose();
  const material = engine.nebulaPoints.material;
  (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
  engine.nebulaPoints = null;
}
