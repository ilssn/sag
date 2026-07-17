"use client";

/**
 * 时间飞行子系统（自 universe-scene-engine 拆出）。
 * 沿计数轴的相机推进/在场感与飞行卡片纪律;宿主为引擎实例。
 */

import * as THREE from "three";

import { SOURCE_ENTRY_CONDENSATION_FRACTION } from "@/components/features/universe-scene-textures";
import { UNIVERSE_FLIGHT_SETTLE_EPSILON, planUniverseTemporalFlightFollow, stepUniverseTemporalFlight, universeTemporalFlightPresence } from "@/lib/universe-temporal-flight";
import type { UniverseForceSceneEngine as Engine } from "./universe-scene-engine";

const FLIGHT_CARD_CALM_SPEED = 240;

const FLIGHT_CARD_HIDE_SPEED = 760;

const FLIGHT_CARD_TRAVEL_MIN = 0.46;

const FLIGHT_CARD_COLLAPSE_MS = 110;

const FLIGHT_CARD_RECOVER_MS = 300;

export function updateTemporalPresence(engine: Engine) {
  const config = engine.flightConfig;
  let linksDirty = false;
  // Before the camera has crossed the vestibule, the source is still the
  // intact nebula: no event stars, no cards — the initial state. They
  // condense in as the dive progresses and dissolve on the way back out.
  const dive = config && config.vestibuleDepth > 0
    ? THREE.MathUtils.smoothstep(
        engine.appliedFlightDepth,
        0,
        config.vestibuleDepth * SOURCE_ENTRY_CONDENSATION_FRACTION,
      )
    : 1;
  engine.nodes.forEach((node) => {
    let scale = 1;
    let opacity = 1;
    if (config && node.kind !== "source" && node.sourceId === config.sourceId) {
      const nodeDepth = config.centerZ - node.z;
      const presence = universeTemporalFlightPresence(
        nodeDepth - engine.appliedFlightDepth,
        config.unitsPerEvent,
      );
      // This method supplies only camera depth and the source's global dive.
      // nodeEmergence() then turns that availability into the same reversible
      // grain → star → card phases used by ordinary and timeline entrances.
      // Keeping depth separate prevents two unrelated birth-scale curves
      // from shrinking the same node twice.
      scale = presence.scale;
      opacity = presence.opacity * dive;
    }
    if (
      Math.abs((node.temporalPresenceScale ?? 1) - scale) < 0.004
      && Math.abs((node.temporalPresenceOpacity ?? 1) - opacity) < 0.004
    ) return;
    node.temporalPresenceScale = scale;
    node.temporalPresenceOpacity = opacity;
    linksDirty = true;
    engine.setObjectOpacity(
      node,
      node.visualOpacity ?? 1,
      node.visuallyEmphasized ?? false,
    );
  });
  if (linksDirty) engine.updateLinkVisuals();
}

/**
 * Advances the flight each frame: integrates the state, translates camera and
 * orbit target together by the depth delta, and pages the window when the
 * camera nears its edge. The camera never waits for data — a page that isn't
 * loaded yet simply condenses in once it lands.
 */

export function updateTemporalFlight(engine: Engine, now: number) {
  if (engine.sourceReturnMotion) return engine.updateSourceReturnMotion(now);
  if (
    engine.sourceNavigationPhase === "origin"
    || engine.sourceNavigationPhase === "overview"
  ) {
    engine.lastFlightStepAt = now;
    return false;
  }
  const config = engine.flightConfig;
  if (!config || !engine.timelineJourney.enabled || !engine.interactive) {
    engine.lastFlightStepAt = now;
    return false;
  }
  const elapsedMs = engine.lastFlightStepAt > 0 ? now - engine.lastFlightStepAt : 16;
  engine.lastFlightStepAt = now;
  const { state, moving } = stepUniverseTemporalFlight(engine.flightState, {
    elapsedMs,
    maxDepth: config.maxDepth,
    reducedMotion: engine.reducedMotion,
  });
  engine.flightState = state;
  const delta = state.depth - engine.appliedFlightDepth;
  if (delta !== 0) {
    engine.appliedFlightDepth = state.depth;
    const camera = engine.graph.camera();
    camera.position.z -= delta;
    if (engine.controls.target) engine.controls.target.z -= delta;
    engine.syncNebulaCorridorUniforms();
    engine.wakeRendering(600);
    updateTemporalPresence(engine);
    engine.updateVisualLayout(now);
    engine.updateNodeMorphScales(now);
    engine.updateLabels(now);
    engine.evaluateLod(now);
  }
  // Cards duck while the camera streaks past and re-expand once it settles.
  // Speed comes from actual depth travel, so wheel inertia and button glides
  // behave identically.
  const instantSpeed = Math.abs(delta) / Math.max(1, elapsedMs) * 1000;
  engine.flightSpeed += (instantSpeed - engine.flightSpeed)
    * (1 - Math.exp(-elapsedMs / 140));
  const cardTarget = 1 - THREE.MathUtils.smoothstep(
    engine.flightSpeed,
    FLIGHT_CARD_CALM_SPEED,
    FLIGHT_CARD_HIDE_SPEED,
  ) * (1 - FLIGHT_CARD_TRAVEL_MIN);
  const cardResponse = 1 - Math.exp(-elapsedMs / (
    cardTarget < engine.flightCardPresence
      ? FLIGHT_CARD_COLLAPSE_MS
      : FLIGHT_CARD_RECOVER_MS
  ));
  const nextCardPresence = THREE.MathUtils.lerp(
    engine.flightCardPresence,
    cardTarget,
    cardResponse,
  );
  const cardsSettling = Math.abs(nextCardPresence - engine.flightCardPresence) > 0.002;
  if (cardsSettling) {
    engine.flightCardPresence = nextCardPresence;
    engine.host.dataset.universeFlightCardPresence = nextCardPresence.toFixed(2);
    if (delta === 0) engine.updateLabels(now);
  }
  engine.host.dataset.universeFlightDepth = state.depth.toFixed(1);
  engine.host.dataset.universeFlightVelocity = state.velocity.toFixed(1);
  if (!moving && engine.host.dataset.universeSourceEntry === "emitting") {
    engine.host.dataset.universeSourceEntry = "ready";
    engine.markSourceExploring();
  }
  if (
    !moving
    && state.depth <= UNIVERSE_FLIGHT_SETTLE_EPSILON
  ) {
    // Depth zero is a real journey stop: restore the intact source nebula
    // before accepting a separate outward gesture back to the overview.
    engine.markSourceOrigin(now);
  }
  const follow = now >= engine.flightFollowCooldownUntil
    ? planUniverseTemporalFlightFollow({
        depth: state.depth,
        windowNearDepth: config.windowNearDepth,
        windowFarDepth: config.windowFarDepth,
        marginUnits: config.unitsPerEvent * 1.5,
        // Fast flight pages ahead of arrival: the corridor must keep
        // condensing in front of the camera, not behind it.
        velocity: state.velocity,
        busy: engine.timelineIsBusy(),
        hasNext: engine.timelineJourney.hasNext,
        hasPrevious: engine.timelineJourney.hasPrevious,
      })
    : null;
  if (follow) {
    engine.flightOwnWindowChange = true;
    void Promise.resolve(engine.moveTimeline(follow)).then((result) => {
      if (result === "advanced") return;
      engine.flightOwnWindowChange = false;
      engine.flightFollowCooldownUntil = performance.now() + 500;
    });
  }
  return moving || cardsSettling;
}
