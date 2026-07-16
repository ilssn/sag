"use client";

import * as React from "react";
import * as THREE from "three";
import { forceCollide } from "d3-force";
import { useLocale, useTranslations } from "next-intl";
import type {
  ForceGraph3DInstance,
  LinkObject,
  NodeObject,
} from "3d-force-graph";

import type { SearchSourceHit, UniversePolicy } from "@/lib/types";
import {
  nextUniverseKeyboardNodeId,
  orderUniverseKeyboardCandidates,
  type UniverseKeyboardDirection,
} from "@/lib/universe-keyboard-navigation";
import { planUniverseFocusCards } from "@/lib/universe-focus-cards";
import {
  universeCardBudget,
  type UniverseViewPreferences,
} from "@/lib/universe-view-preferences";
import {
  resolveUniverseDetailSource,
  universeCardMorph,
  universeDeepLoadMilestone,
  universeVisualDetailProgress,
} from "@/lib/universe-presentation";
import { planUniverseSceneDelta } from "@/lib/universe-scene-transition";
import { UNIVERSE_TEMPORAL_AXIS_UNITS_PER_EVENT } from "@/lib/universe-temporal-axis";
import {
  applyUniverseTemporalFlightWheel,
  brakeUniverseTemporalFlight,
  createUniverseTemporalFlightState,
  flyUniverseTemporalFlightTo,
  planUniverseTemporalFlightFollow,
  stepUniverseTemporalFlight,
  universeTemporalFlightPresence,
  type UniverseTemporalFlightState,
} from "@/lib/universe-temporal-flight";
import { UNIVERSE_SCENE_BUDGET } from "@/lib/universe-working-set";
import { classifyUniverseWebGLContextFailure } from "@/lib/universe-webgl-capability";

export type UniverseSceneNodeKind = "source" | "event" | "entity";

export interface UniverseSceneNode {
  id: string;
  kind: UniverseSceneNodeKind;
  rawId: string;
  sourceId: string;
  label: string;
  description: string;
  category: string;
  radius: number;
  density: number;
  eventCount: number;
  entityCount: number;
  relationCount: number;
  relatedCount: number;
  relatedCountKnown: boolean;
  /** Number of unique one-hop relations already resident in the working set. */
  relatedProgress?: number;
  /** False only when the complete known one-hop relation set is resident. */
  canExploreMore?: boolean;
  importance: number;
  statsReady: boolean;
  state: "latent" | "active";
  root: boolean;
  x: number;
  y: number;
  z: number;
  /** Data-driven presentation factors; omitted values preserve the stable view. */
  presentationScale?: number;
  presentationCardScale?: number;
  presentationOpacity?: number;
  /** Groups an event and its entities onto one shared time-transition path. */
  timelineBundleId?: string;
}

export interface UniverseSceneLink {
  id: string;
  source: string;
  target: string;
  weight: number;
  virtual: boolean;
  /** Multiplies the scene's normal/highlight link opacity. */
  presentationOpacity?: number;
}

/**
 * Everything the scene needs to fly the browsed source's counting axis. Depths
 * are world units from the source's newest moment; the window depths locate the
 * currently visible packages so flight knows when to page.
 */
export interface UniverseSceneTemporalFlight {
  sourceId: string;
  centerZ: number;
  unitsPerEvent: number;
  /**
   * Axis stretch between the entry pose (depth 0) and the first event: the
   * initial state shows only the intact nebula, exploration begins by
   * crossing it, and retreating all the way lands back on it.
   */
  vestibuleDepth: number;
  maxDepth: number;
  windowNearDepth: number;
  windowFarDepth: number;
}

export interface UniverseSceneData {
  epoch: number;
  nodes: UniverseSceneNode[];
  links: UniverseSceneLink[];
  /** Stable identity revision for the projected visible-bundle window. */
  windowRevision?: number;
  /** Identifies whether this window was committed by the active journey intent. */
  windowChangeCause?: "journey" | "synchronization";
  /** Direction is explicit so forward and reverse transitions share one path. */
  windowDirection?: UniverseTimelineDirection;
  /** Null while no browsed source carries a usable time axis. */
  temporalFlight?: UniverseSceneTemporalFlight | null;
}

export interface UniverseSceneHover {
  node: UniverseSceneNode;
  x: number;
  y: number;
}

export interface UniverseSceneView {
  mode: "overview" | "detail";
  sourceId: string | null;
  progress: number;
}

export interface UniverseTimelineJourney {
  enabled: boolean;
  phase: "idle" | "loading" | "transitioning" | "complete";
  hasNext: boolean;
  hasPrevious: boolean;
  networkExhausted: boolean;
  revision: number;
}

export type UniverseTimelineIntentResult =
  | "advanced"
  | "complete"
  | "blocked"
  | "error";

export type UniverseTimelineDirection = "next" | "previous";

export type UniverseSceneUnavailableReason =
  | "dynamic-import"
  | "context-disabled"
  | "context-creation"
  | "initialization"
  | "context-lost";

export interface UniverseSceneHandle {
  focusOverview: () => void;
  resetOverview: () => void;
  focusResult: () => void;
  focusSource: (sourceId: string) => void;
  focusNode: (nodeId: string) => void;
  lockNode: (nodeId: string) => void;
  unlockNode: () => void;
  clearSelection: () => void;
  moveTimeline: (
    direction: UniverseTimelineDirection,
  ) => Promise<UniverseTimelineIntentResult> | void;
  pause: () => void;
  resume: () => void;
}

interface UniverseSceneProps {
  data: UniverseSceneData;
  policy: UniversePolicy;
  sourceHits: SearchSourceHit[];
  selectedId: string | null;
  darkTheme: boolean;
  interactive: boolean;
  reducedMotion: boolean;
  viewPreferences: UniverseViewPreferences;
  timelineJourney: UniverseTimelineJourney;
  onNodeClick: (node: UniverseSceneNode) => void;
  onHover: (value: UniverseSceneHover | null) => void;
  onViewChange: (value: UniverseSceneView) => void;
  onSourceLod: (sourceId: string, level: 0 | 1 | 2 | 3) => void;
  onSelectionClear: () => void;
  actionLabels?: {
    exploreMore: string;
    askAi: string;
  };
  onExploreMore?: (node: UniverseSceneNode) => void;
  onAskNode?: (node: UniverseSceneNode) => void;
  /** Notifies the owner about a real pointer/wheel gesture, never scene animation. */
  onUserInteraction?: () => void;
  onTimelineIntent: (
    direction: UniverseTimelineDirection,
  ) => Promise<UniverseTimelineIntentResult> | UniverseTimelineIntentResult;
  onTimelineSettled: (revision: number) => void;
  onUnavailable?: (reason: UniverseSceneUnavailableReason) => void;
}

interface UniverseSceneText {
  locale: string;
  aria: string;
  keyboardInstructions: string;
  keyboardStatus: (label: string, index: number, total: number) => string;
  exploreSource: (label: string) => string;
  sourceStats: (events: number, entities: number) => string;
  sourceStatsBuilding: (events: number) => string;
  exploreNode: (kind: "event" | "entity", label: string) => string;
  kind: (kind: "event" | "entity") => string;
  relatedEvents: (count: number, category: string) => string;
  continueExploring: (progress: number, total: number | string) => string;
  explorationProgress: (progress: number, total: number | string) => string;
  explorationComplete: (progress: number, total: number | string) => string;
  extractedEvent: string;
  exploreMoreAction?: string;
  askAiAction?: string;
}

interface ForceNode extends NodeObject {
  id: string;
  kind: UniverseSceneNodeKind;
  sourceId: string;
  sceneNode: UniverseSceneNode;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx: number;
  fy: number;
  fz: number;
  object?: THREE.Object3D;
  visualOpacity?: number;
  visuallyEmphasized?: boolean;
  entry?: {
    startedAt: number;
    duration: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    arc: THREE.Vector3;
  };
  entryOpacity?: number;
  renderedEntryOpacity?: number;
  renderedPresentationScale?: number;
  renderedPresentationOpacity?: number;
  presentationScale?: number;
  presentationCardScale?: number;
  presentationOpacity?: number;
  /** Camera-relative presence along the flight axis, refreshed per frame. */
  temporalPresenceScale?: number;
  temporalPresenceOpacity?: number;
  renderedTemporalPresence?: number;
  timelineOpacity?: number;
  timelineScale?: number;
  timelineRetiring?: boolean;
  timelineMotion?: {
    kind: "enter" | "shift" | "exit";
    startedAt: number;
    duration: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    arc: THREE.Vector3;
    opacityFrom: number;
    opacityTo: number;
    scaleFrom: number;
    scaleTo: number;
    presentationScaleFrom: number;
    presentationScaleTo: number;
    presentationCardScaleFrom: number;
    presentationCardScaleTo: number;
    presentationOpacityFrom: number;
    presentationOpacityTo: number;
  };
}

interface ForceLink extends LinkObject<ForceNode> {
  id: string;
  source: string | ForceNode;
  target: string | ForceNode;
  sourceId: string;
  targetId: string;
  sceneLink: UniverseSceneLink;
  visible: boolean;
  highlighted: boolean;
  timelineRetiring?: boolean;
  __lineObj?: THREE.Object3D;
  lineMaterial?: THREE.MeshBasicMaterial;
}

interface NebulaParticle {
  sourceId: string;
  sourceIndex: number;
  offset: THREE.Vector3;
  alpha: number;
  glow: number;
  phase: number;
  twinkle: number;
  core: boolean;
  radial: number;
}

interface SceneLabel {
  nodeId: string;
  kind: "source" | "node";
  element: HTMLElement;
  primary?: HTMLButtonElement;
  actionButtons?: HTMLButtonElement[];
}

interface SceneCallbacks {
  onNodeClick: (node: UniverseSceneNode) => void;
  onHover: (value: UniverseSceneHover | null) => void;
  onViewChange: (value: UniverseSceneView) => void;
  onSourceLod: (sourceId: string, level: 0 | 1 | 2 | 3) => void;
  onSelectionClear: () => void;
  onExploreMore?: (node: UniverseSceneNode) => void;
  onAskNode?: (node: UniverseSceneNode) => void;
  onUserInteraction?: () => void;
  onTimelineIntent: (
    direction: UniverseTimelineDirection,
  ) => Promise<UniverseTimelineIntentResult> | UniverseTimelineIntentResult;
  onTimelineSettled: (revision: number) => void;
  onUnavailable: (reason: UniverseSceneUnavailableReason) => void;
}

interface GraphControls {
  enabled: boolean;
  enableZoom?: boolean;
  enableDamping?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  zoomToCursor?: boolean;
  panSpeed?: number;
  minDistance?: number;
  maxDistance?: number;
  minAzimuthAngle?: number;
  maxAzimuthAngle?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  target?: THREE.Vector3;
  addEventListener: (name: string, callback: () => void) => void;
  removeEventListener: (name: string, callback: () => void) => void;
}

interface ClusterForce {
  (alpha: number): void;
  initialize: (nodes: ForceNode[], ...args: unknown[]) => void;
}

const EVENT_COLOR = new THREE.Color("#ffd166");
const EVENT_LIGHT_COLOR = new THREE.Color("#b77b0b");
const WHITE = new THREE.Color("#ffffff");
export const UNIVERSE_BRAND_GOLD = "#d6ae63";
const NEBULA_BRAND_GOLD = new THREE.Color(UNIVERSE_BRAND_GOLD);
/**
 * A source marker is the colour authority for its nebula. The particle field
 * stores that entry hue and only moves a little toward white for the luminous
 * core. The shader uses it as a secondary tint over the brand-gold overview,
 * then hands the focused source its colour as the camera enters.
 */
const DETAIL_MORPH_RESPONSE_MS = 92;
const DETAIL_MORPH_SETTLE_EPSILON = 0.01;
const HOVER_LABEL_SETTLE_MS = 72;
const HOVER_CLEAR_GRACE_MS = 84;
const MAX_PLACEMENT_MEMORY = 512;
const NEBULA_BURST_MS = 1_400;
// Keep the focused source luminous while retaining the bounded particle
// budget. Detail uses a little more fill-rate only for the selected source;
// overview particles keep the smaller cap and the same 3k ceiling.
// Inside a source the dust is the medium being explored: slightly brighter
// than the overview, so diving in reads as entering the nebula, not leaving it.
const NEBULA_DETAIL_ALPHA = 1.3;
const NEBULA_DETAIL_DUST_POINT_SIZE_CSS = 26;
/**
 * Glow pockets are accents, not weather: the brand galaxy is built purely
 * from sharp grains, so oversized haze sprites read as noise smeared over it.
 */
const NEBULA_GLOW_POINT_SIZE_CSS_DESKTOP = 22;
/** Sentinel z far outside any real layout: the loaded band dims nothing. */
const NEBULA_CORRIDOR_BAND_OFF = 1e8;
/** Ambient drift stays frozen this long after any camera gesture frame. */
const NEBULA_GESTURE_CALM_MS = 480;
/**
 * Inside a source, rotation is a bounded human gaze, not an orbit: you can
 * glance around the corridor but never flip the nebula over — the wheel's
 * "deeper" must always stay roughly ahead. Angles are radians around the
 * corridor's axis-aligned entry bearing.
 */
const BROWSE_GAZE_AZIMUTH_RAD = 0.3;
const BROWSE_GAZE_POLAR_RAD = 0.22;
const BROWSE_GAZE_ROTATE_SPEED = 0.22;
/** Pointer parallax: the view leans faintly toward the cursor, brand-style. */
const BROWSE_PARALLAX_X = 12;
const BROWSE_PARALLAX_Y = 7;
const BROWSE_PARALLAX_RESPONSE = 0.055;
const BROWSE_GAZE_PAN_SPEED = 0.4;
const UNIVERSE_ROTATE_SPEED = 0.42;
const UNIVERSE_PAN_SPEED = 0.52;
/** Corridor entry pose: dive standoff behind the entrance plane… */
const CORRIDOR_ENTRY_STANDOFF = 280;
/**
 * …looking this far down the axis into the past. This is also the orbit
 * pivot: dragging swings the camera around a point DEEP in the corridor, so
 * the deep field stays pinned while the near corridor tilts with the angle —
 * pivoting around a near point would do the opposite and sweep the depths
 * across the screen.
 */
const CORRIDOR_ENTRY_LOOK_AHEAD = 520;
/** …from a slight diagonal so the dust and lateral spread read in parallax. */
const CORRIDOR_ENTRY_LATERAL_X = 38;
const CORRIDOR_ENTRY_LATERAL_Y = 24;
const CORRIDOR_ENTRY_MS = 920;
/** Below this flight speed (units/s) cards are fully expanded. */
const FLIGHT_CARD_CALM_SPEED = 240;
/** Above this flight speed cards have fully collapsed into star points. */
const FLIGHT_CARD_HIDE_SPEED = 760;
/** Cards duck quickly when speed picks up and re-expand a beat after settling. */
const FLIGHT_CARD_COLLAPSE_MS = 110;
const FLIGHT_CARD_RECOVER_MS = 300;
/** Corridor lateral spread mirrors the package axis policy. */
const NEBULA_CORRIDOR_NEAR_SPREAD = 0.18;
const NEBULA_CORRIDOR_FAR_SPREAD = 0.44;
const NEBULA_CORRIDOR_VERTICAL_ASPECT = 0.7;
/**
 * Most corridor dust becomes the distant canyon walls: pushed far out
 * laterally it barely parallaxes under a gaze turn, so the nebula reads as a
 * vast illuminated surrounding instead of debris sweeping past the camera.
 */
const NEBULA_WALL_SHARE = 0.62;
const NEBULA_WALL_LATERAL_MIN = 2.2;
const NEBULA_WALL_LATERAL_MAX = 5.2;
/**
 * Corridor dust is camera-anchored: it repeats modulo this span around the
 * flight depth, so density near the camera is constant no matter whether the
 * source holds 12 events or 5,000. Spreading a fixed budget over the whole
 * axis would dilute a 586-event source to near-invisibility — this is the
 * bounded-window discipline applied to particles.
 */
const NEBULA_CORRIDOR_WRAP_SPAN = 2400;
const NEBULA_GLOW_POINT_SIZE_CSS_MOBILE = 18;
const HIGHLIGHT_FLOW_FRAME_MS = 1000 / 30;
const TIMELINE_WHEEL_LABEL_SELECTOR = "[data-universe-node-id]";
const MAX_RENDER_PIXELS_DESKTOP = 2_400_000;
const MAX_RENDER_PIXELS_MOBILE = 1_100_000;
const UNIVERSE_CAMERA_MIN_DISTANCE = 24;
const UNIVERSE_CAMERA_MAX_DISTANCE = 50_000;
// OrbitControls dispatches change on every damped frame and falls silent once the
// delta drops below its epsilon. Damping decays per frame while the sleep timer
// counts wall-clock, so a low frame rate stretches convergence past any fixed
// settle window — go quiet for this long instead of betting on a constant.
const CAMERA_DAMPING_QUIET_MS = 120;
const CAMERA_DAMPING_RECHECK_MS = 240;
const TIMELINE_EXIT_MIN_MS = 460;
/** In-place condensation reads faster than the staged fly-in choreography. */
const TIMELINE_CONDENSE_MS = 320;
const TIMELINE_DISSOLVE_MS = 300;
const TIMELINE_EXIT_VARIANCE_MS = 90;
const TIMELINE_ENTRY_MS = 560;
const SOURCE_PALETTE = [
  "#6fc0d0",
  "#9d8bd0",
  "#76bf9b",
  "#d3a06f",
  "#7ca4d8",
  "#c98ba7",
];

function stableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function stableDirection(key: string) {
  const azimuth = stableUnit(`${key}:azimuth`) * Math.PI * 2;
  const vertical = stableUnit(`${key}:vertical`) * 2 - 1;
  const planar = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  return new THREE.Vector3(
    Math.cos(azimuth) * planar,
    Math.sin(azimuth) * planar,
    vertical,
  );
}

interface IncrementalObstacle {
  sourceId: string;
  kind: UniverseSceneNode["kind"];
  position: THREE.Vector3;
  radius: number;
}

function incrementalNodeRadius(node: UniverseSceneNode) {
  if (node.kind === "event") return node.root ? 10.5 : 8;
  if (node.kind === "entity") return node.root ? 6.2 : 4.8;
  return 0;
}

function resolveIncrementalPosition(
  node: UniverseSceneNode,
  desired: THREE.Vector3,
  obstacles: readonly IncrementalObstacle[],
) {
  const radius = incrementalNodeRadius(node);
  const fits = (candidate: THREE.Vector3) => obstacles.every((obstacle) => {
    if (obstacle.sourceId !== node.sourceId) return true;
    const clearance = radius + obstacle.radius + 3.5;
    if (candidate.distanceToSquared(obstacle.position) < clearance * clearance) {
      return false;
    }
    if (node.kind === "event" || obstacle.kind === "event") {
      const deltaX = candidate.x - obstacle.position.x;
      const deltaY = candidate.y - obstacle.position.y;
      const planarClearance = clearance * 0.78;
      if (deltaX * deltaX + deltaY * deltaY < planarClearance * planarClearance) {
        return false;
      }
    }
    return true;
  });
  if (fits(desired)) return desired;

  let candidate = desired;
  for (let attempt = 1; attempt <= 48; attempt += 1) {
    const ring = Math.ceil(attempt / 8);
    const distance = ring * (radius * 2 + 8)
      + stableUnit(`${node.id}:placement-distance:${attempt}`) * 4;
    candidate = desired.clone().add(
      stableDirection(`${node.id}:placement-direction:${attempt}`).multiplyScalar(distance),
    );
    if (fits(candidate)) return candidate;
  }
  return candidate;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function easeTimelineMotion(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function presentationScale(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 1;
}

function presentationOpacity(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, 0, 1)
    : 1;
}

function currentNodePresentationScale(node: ForceNode) {
  return node.presentationScale ?? presentationScale(node.sceneNode.presentationScale);
}

function currentNodePresentationCardScale(node: ForceNode) {
  return node.presentationCardScale
    ?? presentationScale(node.sceneNode.presentationCardScale);
}

function currentNodePresentationOpacity(node: ForceNode) {
  return node.presentationOpacity ?? presentationOpacity(node.sceneNode.presentationOpacity);
}

function sourceColor(sourceId: string) {
  return new THREE.Color(
    SOURCE_PALETTE[Math.floor(stableUnit(sourceId) * SOURCE_PALETTE.length) % SOURCE_PALETTE.length],
  );
}

function themedSourceColor(sourceId: string, darkTheme: boolean) {
  const color = sourceColor(sourceId);
  if (!darkTheme) color.offsetHSL(0, 0.04, -0.14);
  return color;
}

/** Shared with the surrounding UI so every source accent resolves identically. */
export function universeSourceAccent(sourceId: string, darkTheme = true) {
  return `#${themedSourceColor(sourceId, darkTheme).getHexString()}`;
}

function endpointId(value: string | ForceNode) {
  return typeof value === "string" ? value : value.id;
}

function makeSpriteTexture(kind: "event" | "entity" | "source") {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const center = 96;

  context.clearRect(0, 0, 192, 192);
  if (kind === "event") {
    const glow = context.createRadialGradient(center, center, 0, center, center, 78);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.08, "rgba(255,255,255,.98)");
    glow.addColorStop(0.24, "rgba(255,255,255,.42)");
    glow.addColorStop(0.58, "rgba(255,255,255,.08)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(10, 10, 172, 172);

    context.fillStyle = "rgba(255,255,255,.9)";
    context.beginPath();
    context.moveTo(center, 18);
    context.quadraticCurveTo(center + 3, center - 14, center + 9, center);
    context.quadraticCurveTo(center + 3, center + 14, center, 174);
    context.quadraticCurveTo(center - 3, center + 14, center - 9, center);
    context.quadraticCurveTo(center - 3, center - 14, center, 18);
    context.fill();

    context.beginPath();
    context.moveTo(22, center);
    context.quadraticCurveTo(center - 14, center - 3, center, center - 8);
    context.quadraticCurveTo(center + 14, center - 3, 170, center);
    context.quadraticCurveTo(center + 14, center + 3, center, center + 8);
    context.quadraticCurveTo(center - 14, center + 3, 22, center);
    context.fill();

    context.globalAlpha = 0.44;
    context.save();
    context.translate(center, center);
    context.rotate(Math.PI / 4);
    context.scale(0.48, 0.48);
    context.translate(-center, -center);
    context.beginPath();
    context.moveTo(center, 28);
    context.quadraticCurveTo(center + 3, center - 12, center + 8, center);
    context.quadraticCurveTo(center + 3, center + 12, center, 164);
    context.quadraticCurveTo(center - 3, center + 12, center - 8, center);
    context.quadraticCurveTo(center - 3, center - 12, center, 28);
    context.fill();
    context.restore();
  } else if (kind === "entity") {
    const glow = context.createRadialGradient(center, center, 0, center, center, 74);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.12, "rgba(255,255,255,.92)");
    glow.addColorStop(0.32, "rgba(255,255,255,.3)");
    glow.addColorStop(0.68, "rgba(255,255,255,.07)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(12, 12, 168, 168);

    context.fillStyle = "rgba(255,255,255,.86)";
    context.beginPath();
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2 - Math.PI / 2;
      const inner = index % 2 === 0 ? 9 : 7;
      const outer = index % 2 === 0 ? 48 : 38;
      context.moveTo(
        center + Math.cos(angle - 0.065) * inner,
        center + Math.sin(angle - 0.065) * inner,
      );
      context.lineTo(
        center + Math.cos(angle) * outer,
        center + Math.sin(angle) * outer,
      );
      context.lineTo(
        center + Math.cos(angle + 0.065) * inner,
        center + Math.sin(angle + 0.065) * inner,
      );
    }
    context.fill();

    context.globalAlpha = 0.64;
    context.beginPath();
    context.arc(142, 66, 3.2, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.3;
    context.beginPath();
    context.arc(55, 128, 2.1, 0, Math.PI * 2);
    context.fill();
  } else {
    const glow = context.createRadialGradient(center, center, 0, center, center, 88);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.1, "rgba(255,255,255,.98)");
    glow.addColorStop(0.28, "rgba(255,255,255,.55)");
    glow.addColorStop(0.62, "rgba(255,255,255,.13)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(4, 4, 184, 184);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeEventCoreTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const center = 64;

  context.clearRect(0, 0, 128, 128);
  context.fillStyle = "rgba(255,255,255,1)";
  context.beginPath();
  for (let index = 0; index < 16; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / 8;
    const ray = Math.floor(index / 2);
    const radius = index % 2 === 1
      ? 8
      : ray % 2 === 0 ? 58 : 32;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
  context.beginPath();
  context.arc(center, center, 7.5, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeEntityCoreTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const center = 48;

  context.clearRect(0, 0, 96, 96);
  const glow = context.createRadialGradient(center, center, 0, center, center, 32);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.34, "rgba(255,255,255,.98)");
  glow.addColorStop(0.58, "rgba(255,255,255,.58)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = glow;
  context.fillRect(12, 12, 72, 72);
  context.strokeStyle = "rgba(255,255,255,.88)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(center, center, 24, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "rgba(255,255,255,1)";
  context.beginPath();
  context.arc(center, center, 8.5, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeNebulaMaterial(darkTheme: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) },
      uThemeAlpha: { value: darkTheme ? 1 : 0.96 },
      uDetail: { value: 0 },
      uDetailAlpha: { value: NEBULA_DETAIL_ALPHA },
      uDetailSource: { value: -1 },
      uBrandColor: { value: NEBULA_BRAND_GOLD.clone() },
      uPointSizeCap: { value: NEBULA_GLOW_POINT_SIZE_CSS_DESKTOP },
      uTime: { value: 0 },
      uMotion: { value: 1 },
      // Loaded-window band on the browsed source's axis, in world z. Particles
      // inside it yield to the real packages that condensed there.
      uCorridorNearZ: { value: NEBULA_CORRIDOR_BAND_OFF },
      uCorridorFarZ: { value: NEBULA_CORRIDOR_BAND_OFF },
      // Camera-anchored dust wrap: current flight depth, the wrap span, the
      // full axis depth and the entry plane's world z of the browsed source.
      uFlightDepth: { value: 0 },
      uCorridorSpan: { value: NEBULA_CORRIDOR_WRAP_SPAN },
      uCorridorAxisDepth: { value: 0 },
      uCorridorCenterZ: { value: 0 },
      uCorridorVestibule: { value: 0 },
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uDetail;
      uniform float uDetailAlpha;
      uniform float uDetailSource;
      uniform vec3 uBrandColor;
      uniform float uPointSizeCap;
      uniform float uTime;
      uniform float uMotion;
      uniform float uCorridorNearZ;
      uniform float uCorridorFarZ;
      uniform float uFlightDepth;
      uniform float uCorridorSpan;
      uniform float uCorridorAxisDepth;
      uniform float uCorridorCenterZ;
      uniform float uCorridorVestibule;
      attribute vec3 aColor;
      attribute vec3 aCorridor;
      attribute float aCorridorWall;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aGlow;
      attribute float aSourceIndex;
      attribute float aShape;
      attribute float aPhase;
      attribute float aTwinkle;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDetail;
      varying float vGlow;
      varying float vShape;
      varying float vPulse;

      void main() {
        float sourceMatch = 1.0 - step(0.5, abs(aSourceIndex - uDetailSource));
        float particleDetail = uDetail * sourceMatch;
        float detailAlpha = mix(
          1.0,
          uDetailAlpha,
          smoothstep(0.18, 0.78, particleDetail)
        );
        // Gold is the stable brand field in overview. Once the focused source
        // takes over, its entry colour becomes the restrained secondary tint.
        float sourceTint = 0.1 + 0.9 * smoothstep(0.22, 0.82, particleDetail);
        vColor = mix(uBrandColor, aColor, sourceTint);
        vAlpha = aAlpha * mix(1.0, detailAlpha, sourceMatch);
        // Depth of field for the whole sky: while inside one source, every
        // other nebula recedes into the dark instead of competing for light —
        // deep enough that their white-hot cores cannot smudge the corridor.
        vAlpha *= mix(1.0, 0.12, uDetail * (1.0 - sourceMatch));
        vDetail = smoothstep(0.08, 0.92, particleDetail);
        vGlow = aGlow;
        vShape = aShape;
        float wave = 0.5 + 0.5 * sin(uTime * (0.72 + aTwinkle * 1.38) + aPhase);
        float glint = pow(wave, mix(2.2, 7.0, aTwinkle));
        float pulse = mix(1.0, 0.8 + glint * 0.5, uMotion * aTwinkle);
        // Diving into a source stretches its galaxy into the exploration
        // corridor: the dust that is still a cloud from outside is, inside,
        // the source's unloaded history laid out along the counting axis.
        // The vestibule holds it back: at flight depth 0 the nebula is intact
        // (the hero pose); the stretch happens as the camera crosses into the
        // axis, and reverses on the way back out.
        float diveMix = uCorridorVestibule > 0.0
          ? smoothstep(0.0, uCorridorVestibule * 0.85, uFlightDepth)
          : 1.0;
        float corridorMix = smoothstep(0.12, 0.88, particleDetail) * diveMix;
        // Camera-anchored wrap: corridor dust repeats modulo the span around
        // the flight depth, so the density near the camera never depends on
        // the source's size — the fixed-window discipline for particles.
        vec3 corridorTarget = position + aCorridor;
        float span = max(1.0, uCorridorSpan);
        float depthAlongAxis = uCorridorCenterZ - corridorTarget.z;
        float rel = mod(depthAlongAxis - uFlightDepth, span);
        if (rel > span * 0.75) rel -= span;
        float wrappedDepth = uFlightDepth + rel;
        corridorTarget.z = uCorridorCenterZ - wrappedDepth;
        vec3 animatedPosition = mix(position, corridorTarget, corridorMix);
        // The axis has real ends: dust never spills in front of the entry
        // plane, and the last stretch dissolves into an unresolved horizon
        // instead of a visible wall — then ends for good.
        float entryFade = smoothstep(-220.0, -40.0, wrappedDepth);
        float endProgress = uCorridorAxisDepth > 0.0
          ? wrappedDepth / uCorridorAxisDepth
          : 0.0;
        float horizonFade = 1.0 - smoothstep(0.82, 1.0, endProgress) * 0.8;
        float overEnd = smoothstep(0.0, 200.0, wrappedDepth - uCorridorAxisDepth);
        // Atmospheric haze with distance ahead keeps the vastness readable
        // without ever going fully dark.
        float aheadUnits = wrappedDepth - uFlightDepth;
        float depthHaze = 1.0 - smoothstep(900.0, 1800.0, aheadUnits) * 0.55;
        float axisFade = entryFade * horizonFade * (1.0 - overEnd) * depthHaze;
        // Where the loaded window already condensed into real packages, the
        // corridor dust steps aside instead of double-exposing them.
        float loadedBand = smoothstep(
          uCorridorFarZ - 30.0,
          uCorridorFarZ + 30.0,
          animatedPosition.z
        ) * (1.0 - smoothstep(
          uCorridorNearZ - 30.0,
          uCorridorNearZ + 30.0,
          animatedPosition.z
        ));
        vAlpha *= mix(1.0, 0.16, corridorMix * loadedBand);
        // The corridor's own light: glow pockets brighten into soft beacons
        // along the axis, and the far end dissolves instead of hard-stopping —
        // vast, with no visible wall.
        float glowParticle = step(0.001, aGlow);
        vAlpha *= mix(1.0, 1.2, corridorMix * glowParticle);
        vAlpha *= mix(1.0, axisFade, corridorMix);
        // Canyon walls are a fine star field, not fog banks: full brightness,
        // grain-sized — their vastness is count and depth, not blur.
        vAlpha *= mix(1.0, 0.95, corridorMix * aCorridorWall);
        // Ambient drift is a whisper, not a float: it breathes only while the
        // camera is idle and holds still under any gesture.
        animatedPosition.x += sin(uTime * 0.28 + aPhase) * 0.16 * uMotion * aTwinkle;
        animatedPosition.y += cos(uTime * 0.24 + aPhase) * 0.12 * uMotion * aTwinkle;
        vec4 mvPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
        float perspective = clamp(360.0 / max(1.0, -mvPosition.z), 0.42, 2.2);
        float detailScale = mix(1.0, 1.28, vDetail);
        float glowScale = mix(1.0, mix(3.6, 4.8, vDetail), aGlow);
        // Corridor beacons swell into soft volumetric pockets of light; wall
        // grains grow only slightly — crisp points, never blobs.
        float corridorBoost = mix(1.0, mix(1.05, 1.25, glowParticle), corridorMix)
          * mix(1.0, 1.35, corridorMix * aCorridorWall);
        float rawPointSize = aSize * uPixelRatio * perspective * pulse
          * detailScale * glowScale * corridorBoost;
        float detailDustCap = mix(13.0, ${NEBULA_DETAIL_DUST_POINT_SIZE_CSS.toFixed(1)}, vDetail)
          * uPixelRatio;
        float capSelect = glowParticle;
        float pointSizeCap = mix(
          detailDustCap,
          uPointSizeCap * (1.0 + 0.25 * corridorMix),
          capSelect
        );
        gl_PointSize = min(max(1.15, rawPointSize), pointSizeCap);
        vPulse = mix(0.92, 1.2, glint);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uThemeAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vDetail;
      varying float vGlow;
      varying float vShape;
      varying float vPulse;

      void main() {
        if (vAlpha < 0.008) discard;
        vec2 centered = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(centered);
        float shapeAlpha;
        if (vGlow > 0.001) {
          // The large cloud sprites take a cheap coherent branch: no rays and
          // no fractional pow across their much larger fragment footprint.
          float radial = clamp(1.0 - distanceFromCenter * 2.0, 0.0, 1.0);
          // A faint warm pocket of light — an accent between the grains,
          // never a fog bank smeared over them.
          float haze = radial * mix(0.55, 0.95, radial);
          shapeAlpha = haze * mix(0.12, 0.2, vDetail) * vGlow;
        } else {
          float softDot = smoothstep(0.5, 0.04, distanceFromCenter);
          float rayX = smoothstep(0.09, 0.0, abs(centered.x))
            * smoothstep(0.5, 0.04, abs(centered.y));
          float rayY = smoothstep(0.09, 0.0, abs(centered.y))
            * smoothstep(0.5, 0.04, abs(centered.x));
          float sparkle = max(softDot, max(rayX, rayY));
          shapeAlpha = mix(softDot, sparkle, vShape);
        }
        if (shapeAlpha < 0.008) discard;
        float whiteMix = vDetail * (0.08 + vShape * 0.18);
        vec3 luminousColor = mix(vColor, vec3(1.0), whiteMix);
        float detailBloom = mix(1.0, 1.28, vDetail);
        gl_FragColor = vec4(
          luminousColor,
          min(1.0, shapeAlpha * vAlpha * vPulse * uThemeAlpha * detailBloom)
        );
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Brand look: density carries the light — the white-hot heart comes from
    // sheer particle count, not additive bloom.
    blending: THREE.NormalBlending,
  });
}

class UniverseForceSceneEngine {
  private graph: ForceGraph3DInstance<ForceNode, ForceLink>;
  private host: HTMLDivElement;
  private keyboardStatusElement: HTMLElement;
  private rendererCanvas: HTMLCanvasElement;
  private controls: GraphControls;
  private resizeObserver: ResizeObserver;
  private policy: UniversePolicy;
  private viewPreferences: UniverseViewPreferences;
  private callbacks: SceneCallbacks = {
    onNodeClick: () => undefined,
    onHover: () => undefined,
    onViewChange: () => undefined,
    onSourceLod: () => undefined,
    onSelectionClear: () => undefined,
    onExploreMore: () => undefined,
    onAskNode: () => undefined,
    onUserInteraction: () => undefined,
    onTimelineIntent: () => "blocked",
    onTimelineSettled: () => undefined,
    onUnavailable: () => undefined,
  };
  private unavailableNotified = false;
  private nodes = new Map<string, ForceNode>();
  private placementTargets = new Map<string, THREE.Vector3>();
  private links: ForceLink[] = [];
  private linkStart = new THREE.Vector3();
  private linkEnd = new THREE.Vector3();
  private linkWorldEnd = new THREE.Vector3();
  private adjacency = new Map<string, Set<string>>();
  private visibleEdgeIds = new Set<string>();
  private sourceHits: SearchSourceHit[] = [];
  private selectedId: string | null = null;
  private lockedId: string | null = null;
  private hoveredId: string | null = null;
  private hoveredFromLabel = false;
  private keyboardFocusedId: string | null = null;
  private keyboardActive = false;
  private darkTheme = false;
  private interactive = true;
  private reducedMotion = false;
  private paused = true;
  private renderingAwake = false;
  private sleepTimer: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private pointerActive = false;
  private forwardedTimelineWheelEvents = new WeakSet<Event>();
  private flightConfig: UniverseSceneTemporalFlight | null = null;
  private flightState: UniverseTemporalFlightState =
    createUniverseTemporalFlightState();
  /** Depth already translated into the camera; deltas compose with orbiting. */
  private appliedFlightDepth = 0;
  private lastFlightStepAt = 0;
  private flightOwnWindowChange = false;
  private flightFollowCooldownUntil = 0;
  private eventTexture = makeSpriteTexture("event");
  private eventCoreTexture = makeEventCoreTexture();
  private entityTexture = makeSpriteTexture("entity");
  private entityCoreTexture = makeEntityCoreTexture();
  private sourceTexture = makeSpriteTexture("source");
  private sourceHitGeometry = new THREE.SphereGeometry(1, 10, 8);
  private highlightFlowMaterial: THREE.SpriteMaterial;
  private highlightFlowSprites = new Map<string, THREE.Sprite>();
  private highlightFlowTimer: number | null = null;
  private lastHighlightFlowAt = 0;
  private nebulaPoints: THREE.Points | null = null;
  private nebulaParticles: NebulaParticle[] = [];
  private nebulaSourceIndices = new Map<string, number>();
  private nebulaAlphaKey = "";
  private nebulaAlphaUploads = 0;
  private lastNebulaAnimationAt = 0;
  private nebulaAnimationUntil = 0;
  /** While in the future, the ambient nebula drift holds still (camera gestures). */
  private cameraCalmUntil = 0;
  /** Low-passed flight speed in units/s, fed by actual per-frame depth travel. */
  private flightSpeed = 0;
  /** 1 = cards fully expanded; eases toward 0 as flight speed rises. */
  private flightCardPresence = 1;
  /** True while rotation is clamped to the corridor's forward gaze cone. */
  private browseGazeApplied = false;
  /** Applied pointer-parallax lean, in world units along camera right/up. */
  private parallaxApplied = { x: 0, y: 0 };
  private browseGazeTimer: number | null = null;
  private sourceSignature = "";
  private labelLayer: HTMLDivElement;
  private labels: SceneLabel[] = [];
  private labelPlacementBudget = { events: 0, entities: 0, total: 0 };
  private renderedLabelFocusId: string | null = null;
  private hoverLabelTimer: number | null = null;
  private hoverLabelFrame: number | null = null;
  private hoverClearTimer: number | null = null;
  private rebuildingLabels = false;
  private loopFrame: number | null = null;
  private loopKeepAliveUntil = 0;
  private lastLabelAt = 0;
  private lastLodAt = 0;
  private lastVisualLodAt = 0;
  private lastNodeMorphAt = 0;
  private lastControlsChangeAt = 0;
  private latchedDetailSourceId: string | null = null;
  private visualSourceId: string | null = null;
  private visualDetailMix = 0;
  private visualDetailTarget = 0;
  private reportedViewSourceId: string | null = null;
  private requestedSourceId: string | null = null;
  private overviewRequested = true;
  private lodLevels = new Map<string, 0 | 1 | 2 | 3>();
  private deepLodMilestones = new Map<string, number>();
  private lodTimer: number | null = null;
  private pendingLod: {
    sourceId: string;
    level: 0 | 1 | 2 | 3;
    deepMilestone: number;
    notify: boolean;
  } | null = null;
  private lodArmed = false;
  private timelineJourney: UniverseTimelineJourney = {
    enabled: false,
    phase: "idle",
    hasNext: false,
    hasPrevious: false,
    networkExhausted: false,
    revision: 0,
  };
  private dataWindowRevision: number | null = null;
  private timelineIntentPending = false;
  private timelineIntentToken = 0;
  private timelineIntentDirection: UniverseTimelineDirection | null = null;
  private timelineMotionPhase:
    | "idle"
    | "awaiting-result"
    | "awaiting-data"
    | "entering" = "idle";
  private timelineRevisionWatchTimer: number | null = null;
  private currentPixelRatio: number | null = null;
  private clusterNodes: ForceNode[] = [];
  private dataReady = false;
  private initialFocusTimer: number | null = null;
  private resizePending = false;
  private didInitialFocus = false;
  private dataEpoch = 0;
  private text: UniverseSceneText;

  constructor(
    host: HTMLDivElement,
    policy: UniversePolicy,
    viewPreferences: UniverseViewPreferences,
    text: UniverseSceneText,
    keyboardStatusElement: HTMLElement,
    ForceGraph3D: new (
      element: HTMLElement,
      options?: { controlType?: "orbit"; rendererConfig?: THREE.WebGLRendererParameters },
    ) => ForceGraph3DInstance<ForceNode, ForceLink>,
  ) {
    this.host = host;
    this.policy = policy;
    this.viewPreferences = viewPreferences;
    this.text = text;
    this.keyboardStatusElement = keyboardStatusElement;
    this.host.replaceChildren();
    this.host.style.position = "absolute";
    this.host.style.inset = "0";
    this.highlightFlowMaterial = new THREE.SpriteMaterial({
      map: this.entityCoreTexture,
      color: "#b5f2fb",
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });

    this.graph = new ForceGraph3D(this.host, {
      controlType: "orbit",
      rendererConfig: {
        alpha: true,
        antialias: true,
        // This is only a browser hint. Forcing the discrete/high-performance
        // adapter can reject otherwise valid WebGL2 contexts on remote,
        // battery-saving, and virtualized Chrome sessions.
        powerPreference: "default",
      },
    });
    this.graph
      .width(Math.max(1, this.host.clientWidth))
      .height(Math.max(1, this.host.clientHeight))
      .backgroundColor("rgba(0,0,0,0)")
      .showNavInfo(false)
      .nodeId("id")
      .nodeLabel(() => "")
      .nodeThreeObject((node) => this.createNodeObject(node))
      .nodeThreeObjectExtend(false)
      // Keep a cheap, straight low-poly object for every relation. Presentation-
      // only visibility is changed on the object/material directly so hover never
      // has to trigger a full graph refresh, which rebuilds every graph object.
      .linkVisibility(() => true)
      .linkMaterial((link) => this.ensureLinkMaterial(link))
      .linkOpacity(1)
      // Keep low-density graphs comfortably visible, then taper the geometry
      // as the working set approaches its edge budget. The library rounds to
      // tenths and re-evaluates this accessor whenever graphData changes.
      .linkWidth(() => this.linkWorldWidth())
      .linkResolution(3)
      .linkCurvature(0)
      .linkDirectionalParticles(0)
      .enableNodeDrag(false)
      .enablePointerInteraction(true)
      .showPointerCursor((object) => Boolean(object))
      // Positions are supplied by the deterministic incremental layout below;
      // the force engine only needs one tick to synchronize graph objects.
      .warmupTicks(0)
      .cooldownTicks(1)
      .cooldownTime(64)
      .d3VelocityDecay(0.48)
      .onNodeHover((node) => this.handleNodeHover(node, false))
      .onNodeClick((node, event) => {
        if (this.timelineIsBusy()) return;
        if (
          node.kind !== "source"
          && (this.visualDetailMix < 0.5 || node.sourceId !== this.visualSourceId)
        ) return;
        this.pointerActive = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        this.clearKeyboardFocus(false);
        this.callbacks.onNodeClick(node.sceneNode);
      })
      .onBackgroundClick(() => {
        if (this.lockedId || this.selectedId || this.keyboardFocusedId) {
          this.callbacks.onSelectionClear();
          return;
        }
        if (this.timelineIsBusy()) return;
        if (this.hoveredId) this.handleNodeHover(null, false, true);
      })
      .onEngineTick(() => {
        this.syncFrozenNodeCoordinates();
        this.updateLabels(performance.now());
      })
      .onEngineStop(() => {
        this.syncFrozenNodeCoordinates();
        this.updateLabels(performance.now(), true);
      });

    const renderer = this.graph.renderer();
    this.rendererCanvas = renderer.domElement;
    this.rendererCanvas.tabIndex = -1;
    this.rendererCanvas.addEventListener("webglcontextlost", this.handleWebglContextLost);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    const camera = this.graph.camera() as THREE.PerspectiveCamera;
    if (camera.isPerspectiveCamera) {
      camera.near = 0.1;
      camera.far = 100_000;
      // Brand-wide field of view: the corridor breathes instead of tunnelling.
      camera.fov = 56;
      camera.updateProjectionMatrix();
    }

    this.controls = this.graph.controls() as GraphControls;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.095;
    this.controls.rotateSpeed = UNIVERSE_ROTATE_SPEED;
    this.controls.zoomSpeed = 0.72;
    this.controls.zoomToCursor = true;
    this.controls.panSpeed = UNIVERSE_PAN_SPEED;
    this.controls.minDistance = UNIVERSE_CAMERA_MIN_DISTANCE;
    this.controls.maxDistance = UNIVERSE_CAMERA_MAX_DISTANCE;
    this.controls.addEventListener("start", this.handleControlsStart);
    this.controls.addEventListener("change", this.handleControlsChange);

    const charge = this.graph.d3Force("charge") as {
      strength?: (value: number | ((node: ForceNode) => number)) => unknown;
      distanceMax?: (value: number) => unknown;
    } | undefined;
    charge?.strength?.((node: ForceNode) => {
      if (node.kind === "source") return -70;
      if (node.kind === "event") return -42;
      return -24;
    });
    charge?.distanceMax?.(240);

    const linkForce = this.graph.d3Force("link") as {
      distance?: (value: number | ((link: ForceLink) => number)) => unknown;
      strength?: (value: number | ((link: ForceLink) => number)) => unknown;
    } | undefined;
    linkForce?.distance?.((link: ForceLink) => 36 + (1 - link.sceneLink.weight) * 22);
    linkForce?.strength?.((link: ForceLink) => 0.15 + link.sceneLink.weight * 0.18);
    const collide = forceCollide<ForceNode>((node) => {
      if (node.kind === "source") return 18;
      if (node.kind === "event") return node.sceneNode.root ? 7.2 : 5.6;
      return node.sceneNode.root ? 6.2 : 4.8;
    }).strength(0.82).iterations(2);
    const collideForce = ((alpha: number) => collide(alpha)) as ClusterForce;
    collideForce.initialize = (nodes, ...args) => {
      // d3-force-3d supplies (nodes, dimensions, random); d3-force expects
      // (nodes, random). Adapt the signature while retaining its collision force.
      const random = args.find((value): value is () => number => typeof value === "function");
      collide.initialize(nodes, random ?? Math.random);
    };
    this.graph.d3Force("collide", collideForce);
    this.graph.d3Force("center", null);
    this.graph.d3Force("source-cluster", this.makeClusterForce());

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "sag-universe-label-layer";
    this.host.appendChild(this.labelLayer);
    this.host.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    this.host.addEventListener("pointerdown", this.handlePointerDown, { capture: true });
    // Not passive: in flight the handler consumes the gesture outright.
    this.host.addEventListener("wheel", this.handleTimelineWheel, {
      capture: true,
      passive: false,
    });
    this.host.addEventListener("pointerenter", this.handlePointerEnter, { passive: true });
    this.host.addEventListener("pointerleave", this.handlePointerLeave, { passive: true });
    this.host.addEventListener("focus", this.handleCanvasFocus);
    this.host.addEventListener("blur", this.handleCanvasBlur);
    this.host.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("pointermove", this.handleWindowPointerMove, { passive: true });
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.host);
    this.pause();
  }

  setCallbacks(callbacks: SceneCallbacks) {
    this.callbacks = callbacks;
    this.callbacks.onViewChange({
      mode: this.reportedViewSourceId ? "detail" : "overview",
      sourceId: this.reportedViewSourceId,
      progress: this.visualDetailMix,
    });
  }

  setOptions(options: {
    interactive: boolean;
    reducedMotion: boolean;
    darkTheme: boolean;
    viewPreferences: UniverseViewPreferences;
    timelineJourney: UniverseTimelineJourney;
    text: UniverseSceneText;
  }) {
    const themeChanged = this.darkTheme !== options.darkTheme;
    const motionChanged = this.reducedMotion !== options.reducedMotion;
    const timelineDisabled = this.timelineJourney.enabled && !options.timelineJourney.enabled;
    const cardPreferencesChanged =
      this.viewPreferences.showEventCards !== options.viewPreferences.showEventCards
      || this.viewPreferences.showEntityCards !== options.viewPreferences.showEntityCards;
    const leavingInteractiveMode = this.interactive && !options.interactive;
    const labelTextChanged = this.text.locale !== options.text.locale
      || this.text.exploreMoreAction !== options.text.exploreMoreAction
      || this.text.askAiAction !== options.text.askAiAction;
    this.darkTheme = options.darkTheme;
    this.interactive = options.interactive;
    this.reducedMotion = options.reducedMotion;
    this.viewPreferences = options.viewPreferences;
    this.timelineJourney = options.timelineJourney;
    this.text = options.text;
    this.host.dataset.universeReducedMotion = String(options.reducedMotion);
    this.host.dataset.universeEventCards = String(options.viewPreferences.showEventCards);
    this.host.dataset.universeEntityCards = String(options.viewPreferences.showEntityCards);
    this.syncTimelineDiagnostics();
    this.controls.enabled = options.interactive;
    this.controls.enableZoom = options.interactive;
    this.controls.enableDamping = !options.reducedMotion;
    this.graph
      .enablePointerInteraction(options.interactive)
      .enableNavigationControls(options.interactive)
      .enableNodeDrag(false);
    if (timelineDisabled) {
      this.flightState = brakeUniverseTemporalFlight(this.flightState);
      this.cancelTimelineTransition(true);
    }
    if (leavingInteractiveMode) this.resetOverview();
    if (!options.interactive) this.pause();
    this.updatePixelRatio();
    if (themeChanged) {
      this.sourceSignature = "";
      this.rebuildNebula();
      this.updateNodeTheme();
      this.updateObjectOpacities();
      this.updateLinkVisuals();
    }
    if (motionChanged) this.syncHighlightFlowSprites();
    if (this.dataReady && (cardPreferencesChanged || labelTextChanged)) this.rebuildLabels();
    const keyboardCandidates = this.keyboardCandidates();
    if (
      this.keyboardFocusedId
      && !keyboardCandidates.some((candidate) => candidate.id === this.keyboardFocusedId)
    ) this.clearKeyboardFocus(true);
    else this.updateKeyboardStatus(keyboardCandidates);
    this.updateNebulaMotionState();
    this.armNebulaAnimation();
  }

  setSelection(selectedId: string | null) {
    const nextSelectedId = selectedId && this.nodes.has(selectedId) ? selectedId : null;
    if (this.selectedId === nextSelectedId) return;
    this.selectedId = nextSelectedId;
    this.host.dataset.universeSelectedId = nextSelectedId ?? "";
    if (this.labelFocusId() !== this.renderedLabelFocusId) this.rebuildLabels();
    this.applyHighlight();
    this.updateVisualLayout(performance.now(), true);
  }

  setData(
    data: UniverseSceneData,
    policy: UniversePolicy,
    sourceHits: SearchSourceHit[],
  ) {
    this.policy = policy;
    const epochChanged = data.epoch !== this.dataEpoch;
    const nextWindowRevision = data.windowRevision ?? 0;
    const windowChanged = !epochChanged
      && this.dataWindowRevision !== null
      && nextWindowRevision !== this.dataWindowRevision;
    const windowChangeCause = data.windowChangeCause ?? "synchronization";
    const windowDirection = data.windowDirection
      ?? this.timelineIntentDirection
      ?? "next";
    if (
      (
        !epochChanged
        && windowChangeCause === "synchronization"
        && this.timelineMotionPhase === "entering"
      )
      || (
        windowChanged
        && this.shouldCancelTimelineIntentForWindowChange(windowChangeCause)
      )
    ) {
      // A configuration/device reflow can change the projected window while the
      // old gesture is still leaving or waiting for data. Invalidate that intent
      // before adopting the independent window so its callback cannot advance a
      // second time after the replacement entrance resolves its motion promise.
      this.cancelTimelineTransition(true);
    }
    const animateTimelineWindow = windowChanged && this.timelineJourney.enabled;
    this.dataWindowRevision = nextWindowRevision;
    this.host.dataset.universeWindowRevision = String(nextWindowRevision);
    const nextFlight = data.temporalFlight ?? null;
    const flightSourceChanged = nextFlight?.sourceId !== this.flightConfig?.sourceId;
    this.flightConfig = nextFlight;
    // The gaze cone belongs to one corridor: leaving or switching sources
    // frees the camera immediately; the next entry dive re-applies it.
    if (!nextFlight || flightSourceChanged) this.releaseBrowseGaze();
    if (nextFlight && flightSourceChanged) {
      // A fresh browse session starts at its window's newest package. The entry
      // camera framing is authoritative, so this reset applies no delta.
      this.flightState = createUniverseTemporalFlightState(
        nextFlight.windowNearDepth,
      );
      this.appliedFlightDepth = this.flightState.depth;
      this.flightOwnWindowChange = false;
    } else if (nextFlight && windowChanged && !this.flightOwnWindowChange) {
      // A window moved by buttons or search glides the camera to the new page;
      // a window moved by flight itself already has the camera there.
      this.flightState = flyUniverseTemporalFlightTo(
        this.flightState,
        nextFlight.windowNearDepth,
      );
      this.wakeRendering(900);
      this.startLoop(900);
    }
    if (windowChanged) this.flightOwnWindowChange = false;
    if (epochChanged) {
      this.flightState = brakeUniverseTemporalFlight(this.flightState);
      this.cancelTimelineTransition(true);
      this.releaseLockedNode(false);
      this.dataEpoch = data.epoch;
      this.placementTargets.clear();
      this.host.dataset.universePlacementMemory = "0";
      this.latchedDetailSourceId = null;
      this.visualSourceId = null;
      this.visualDetailMix = 0;
      this.visualDetailTarget = 0;
      this.reportedViewSourceId = null;
      this.requestedSourceId = null;
      this.overviewRequested = true;
      this.lodLevels.clear();
      this.deepLodMilestones.clear();
      this.pendingLod = null;
      this.lodArmed = false;
      if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
      this.lodTimer = null;
    }
    const previousSearchSignature = this.sourceHits.map((hit) => hit.source_id).join("|");
    const nextSearchSignature = sourceHits.map((hit) => hit.source_id).join("|");
    const searchFocusSourceId = previousSearchSignature !== nextSearchSignature
      ? sourceHits[0]?.source_id
      : undefined;
    const oldNodes = this.nodes;
    const persistentAnchor = oldNodes.get(this.lockedId ?? this.selectedId ?? "");
    const nextNodes = new Map<string, ForceNode>();
    const sceneNodesById = new Map(data.nodes.map((node) => [node.id, node]));
    const nodeDelta = planUniverseSceneDelta(oldNodes.keys(), sceneNodesById.keys());
    this.host.dataset.universeRetainedNodeCount = String(nodeDelta.retainedIds.length);
    this.host.dataset.universeEnteringNodeDelta = String(nodeDelta.enteringIds.length);
    this.host.dataset.universeExitingNodeDelta = String(nodeDelta.exitingIds.length);
    const expansionAnchors = new Map<string, string>();
    const relationNeighbors = new Map<string, Set<string>>();
    const anchorPriority = (id: string) => {
      if (id === this.lockedId) return 3;
      if (id === this.selectedId) return 2;
      return oldNodes.get(id)?.kind === "event" ? 1 : 0;
    };
    data.links.forEach((link) => {
      if (!relationNeighbors.has(link.source)) relationNeighbors.set(link.source, new Set());
      if (!relationNeighbors.has(link.target)) relationNeighbors.set(link.target, new Set());
      relationNeighbors.get(link.source)?.add(link.target);
      relationNeighbors.get(link.target)?.add(link.source);
      const sourceExists = oldNodes.has(link.source);
      const targetExists = oldNodes.has(link.target);
      if (sourceExists === targetExists) return;
      const newId = sourceExists ? link.target : link.source;
      const anchorId = sourceExists ? link.source : link.target;
      const currentAnchor = expansionAnchors.get(newId);
      const candidatePriority = anchorPriority(anchorId);
      const currentPriority = currentAnchor ? anchorPriority(currentAnchor) : -1;
      if (
        !currentAnchor
        || candidatePriority > currentPriority
        || (candidatePriority === currentPriority && anchorId.localeCompare(currentAnchor) < 0)
      ) {
        expansionAnchors.set(newId, anchorId);
      }
    });
    const sourceScenes = new Map(
      data.nodes
        .filter((node) => node.kind === "source")
        .map((node) => [node.sourceId, node]),
    );
    const currentSources = new Map(
      [...oldNodes.values()]
        .filter((node) => node.kind === "source")
        .map((node) => [node.sourceId, new THREE.Vector3(
          Number.isFinite(node.x) ? node.x : 0,
          Number.isFinite(node.y) ? node.y : 0,
          Number.isFinite(node.z) ? node.z : 0,
        )]),
    );
    const entryNow = performance.now();
    const controlsTarget = this.controls.target;
    const timelineTransitionOrigin = controlsTarget
      && Number.isFinite(controlsTarget.x)
      && Number.isFinite(controlsTarget.y)
      && Number.isFinite(controlsTarget.z)
      ? controlsTarget.clone()
      : new THREE.Vector3();
    this.host.dataset.universeTimelineOrigin = [
      timelineTransitionOrigin.x,
      timelineTransitionOrigin.y,
      timelineTransitionOrigin.z,
    ].map((value) => value.toFixed(2)).join(",");
    if (animateTimelineWindow) {
      if (this.timelineRevisionWatchTimer !== null) {
        window.clearTimeout(this.timelineRevisionWatchTimer);
        this.timelineRevisionWatchTimer = null;
      }
      this.timelineIntentPending = true;
      this.timelineMotionPhase = "entering";
      this.controls.enableZoom = this.interactive;
      this.timelineIntentDirection = windowDirection;
      this.host.dataset.universeTimelineDirection = windowDirection;
    }
    const entryOrderById = new Map<string, number>();
    const entrantCountBySource = new Map<string, number>();
    const entrants = data.nodes
      .filter((node) => node.kind !== "source" && !oldNodes.has(node.id))
      .sort((left, right) => {
        const sourceOrder = left.sourceId.localeCompare(right.sourceId);
        if (sourceOrder) return sourceOrder;
        if (left.root !== right.root) return left.root ? -1 : 1;
        if (left.kind !== right.kind) return left.kind === "event" ? -1 : 1;
        return left.id.localeCompare(right.id);
      });
    const placementStartedAt = performance.now();
    const obstacles: IncrementalObstacle[] = [...oldNodes.values()]
      .filter((node) => node.kind !== "source" && sceneNodesById.has(node.id))
      .map((node) => ({
        sourceId: node.sourceId,
        kind: node.kind,
        position: node.entry?.to.clone() ?? new THREE.Vector3(node.x, node.y, node.z),
        radius: incrementalNodeRadius(node.sceneNode),
      }));
    const incrementalTargets = new Map<string, THREE.Vector3>();
    const scenePosition = (node: UniverseSceneNode) => new THREE.Vector3(
      Number.isFinite(node.x) ? node.x : 0,
      Number.isFinite(node.y) ? node.y : 0,
      Number.isFinite(node.z) ? node.z : 0,
    );
    const canonicalTarget = (node: UniverseSceneNode) => {
      const position = scenePosition(node);
      const sourceScene = sourceScenes.get(node.sourceId);
      const sourceBase = sourceScene ? scenePosition(sourceScene) : position.clone();
      const currentSource = currentSources.get(node.sourceId) ?? sourceBase;
      const anchorId = expansionAnchors.get(node.id);
      const anchor = anchorId ? oldNodes.get(anchorId) : undefined;
      const anchorScene = anchorId ? sceneNodesById.get(anchorId) : undefined;
      if (anchor && anchorScene) {
        return new THREE.Vector3(anchor.x, anchor.y, anchor.z).add(
          position.sub(scenePosition(anchorScene)),
        );
      }
      const placedNeighborId = [...(relationNeighbors.get(node.id) ?? [])]
        .filter((id) => incrementalTargets.has(id))
        .sort((left, right) => left.localeCompare(right))[0];
      const placedNeighbor = placedNeighborId
        ? incrementalTargets.get(placedNeighborId)
        : undefined;
      const placedNeighborScene = placedNeighborId
        ? sceneNodesById.get(placedNeighborId)
        : undefined;
      if (placedNeighbor && placedNeighborScene) {
        return placedNeighbor.clone().add(
          position.sub(scenePosition(placedNeighborScene)),
        );
      }
      return position.add(currentSource).sub(sourceBase);
    };
    const timelineTarget = (node: UniverseSceneNode) => {
      const position = scenePosition(node);
      const sourceScene = sourceScenes.get(node.sourceId);
      const sourceBase = sourceScene ? scenePosition(sourceScene) : position.clone();
      const currentSource = currentSources.get(node.sourceId) ?? sourceBase;
      return position.add(currentSource).sub(sourceBase);
    };
    const timelineMotionFor = (
      node: UniverseSceneNode,
      destination: THREE.Vector3,
      existingPosition?: THREE.Vector3,
      previousVisual?: {
        opacity: number;
        scale: number;
        presentationScale: number;
        presentationCardScale: number;
        presentationOpacity: number;
      },
    ): ForceNode["timelineMotion"] => {
      if (!animateTimelineWindow || this.reducedMotion || node.kind === "source") {
        return undefined;
      }
      if (
        existingPosition
        && previousVisual
        && existingPosition.distanceToSquared(destination) < 0.0001
        && Math.abs(previousVisual.opacity - 1) < 0.001
        && Math.abs(previousVisual.scale - 1) < 0.001
        && Math.abs(
          previousVisual.presentationScale
            - presentationScale(node.presentationScale),
        ) < 0.001
        && Math.abs(
          previousVisual.presentationCardScale
            - presentationScale(node.presentationCardScale),
        ) < 0.001
        && Math.abs(
          previousVisual.presentationOpacity
            - presentationOpacity(node.presentationOpacity),
        ) < 0.001
      ) return undefined;
      const motionGroupId = node.timelineBundleId ?? node.id;
      // Under flight the camera is already where the data lands: entrants
      // condense in place at their axis position (no birth point to travel
      // from, no arc), which keeps a moving camera's world stationary.
      const condenseInPlace = this.flightConfig !== null;
      const from = existingPosition?.clone()
        ?? (condenseInPlace
          ? destination.clone()
          : timelineTransitionOrigin.clone());
      const travel = destination.clone().sub(from);
      const travelDirection = travel.lengthSq() > 0.0001
        ? travel.clone().normalize()
        : new THREE.Vector3(1, 0, 0);
      const arc = stableDirection(`${motionGroupId}:timeline-entry-arc`);
      arc.addScaledVector(travelDirection, -arc.dot(travelDirection));
      if (arc.lengthSq() < 0.0001) arc.set(-travelDirection.y, travelDirection.x, 0.18);
      arc.normalize().multiplyScalar(
        travel.lengthSq() < 0.0001
          ? 0
          : Math.min(12, 3 + travel.length() * 0.055),
      );
      return {
        kind: existingPosition ? "shift" : "enter",
        // A timeline window is one visual batch. Temporal depth and scale carry
        // chronology; per-node start delays would read as incremental popping.
        startedAt: entryNow,
        duration: condenseInPlace ? TIMELINE_CONDENSE_MS : TIMELINE_ENTRY_MS,
        from,
        to: destination.clone(),
        arc,
        opacityFrom: previousVisual?.opacity ?? 0,
        opacityTo: 1,
        scaleFrom: previousVisual?.scale ?? (condenseInPlace ? 0.4 : 0.12),
        scaleTo: 1,
        presentationScaleFrom: previousVisual?.presentationScale
          ?? presentationScale(node.presentationScale),
        presentationScaleTo: presentationScale(node.presentationScale),
        presentationCardScaleFrom: previousVisual?.presentationCardScale
          ?? presentationScale(node.presentationCardScale),
        presentationCardScaleTo: presentationScale(node.presentationCardScale),
        presentationOpacityFrom: previousVisual?.presentationOpacity
          ?? presentationOpacity(node.presentationOpacity),
        presentationOpacityTo: presentationOpacity(node.presentationOpacity),
      };
    };
    entrants.forEach((node) => {
      const index = entrantCountBySource.get(node.sourceId) ?? 0;
      entryOrderById.set(node.id, index);
      entrantCountBySource.set(node.sourceId, index + 1);
      const remembered = this.placementTargets.get(node.id);
      const target = animateTimelineWindow
        ? timelineTarget(node)
        : remembered?.clone()
          ?? resolveIncrementalPosition(node, canonicalTarget(node), obstacles);
      this.rememberPlacement(node.id, target);
      incrementalTargets.set(node.id, target);
      obstacles.push({
        sourceId: node.sourceId,
        kind: node.kind,
        position: target,
        radius: incrementalNodeRadius(node),
      });
    });
    this.host.dataset.universePlacementCount = String(entrants.length);
    this.host.dataset.universePlacementMs = (performance.now() - placementStartedAt).toFixed(2);

    data.nodes.forEach((sceneNode) => {
      const existing = oldNodes.get(sceneNode.id);
      const sourceScene = sourceScenes.get(sceneNode.sourceId);
      const currentSource = currentSources.get(sceneNode.sourceId)
        ?? (sourceScene ? scenePosition(sourceScene) : scenePosition(sceneNode));
      if (existing) {
        const previousVisual = {
          opacity: existing.timelineOpacity ?? 1,
          scale: existing.timelineScale ?? 1,
          presentationScale: currentNodePresentationScale(existing),
          presentationCardScale: currentNodePresentationCardScale(existing),
          presentationOpacity: currentNodePresentationOpacity(existing),
        };
        existing.kind = sceneNode.kind;
        existing.sourceId = sceneNode.sourceId;
        existing.sceneNode = sceneNode;
        existing.timelineRetiring = false;
        existing.visualOpacity = undefined;
        existing.visuallyEmphasized = undefined;
        existing.renderedEntryOpacity = undefined;
        existing.renderedPresentationScale = undefined;
        existing.renderedPresentationOpacity = undefined;
        if (animateTimelineWindow && sceneNode.kind !== "source") {
          const desired = timelineTarget(sceneNode);
          const timelineMotion = timelineMotionFor(
            sceneNode,
            desired,
            new THREE.Vector3(existing.x, existing.y, existing.z),
            previousVisual,
          );
          existing.entry = undefined;
          existing.entryOpacity = undefined;
          existing.timelineMotion = timelineMotion;
          existing.timelineOpacity = timelineMotion?.opacityFrom ?? 1;
          existing.timelineScale = timelineMotion?.scaleFrom ?? 1;
          existing.presentationScale = timelineMotion?.presentationScaleFrom
            ?? presentationScale(sceneNode.presentationScale);
          existing.presentationCardScale = timelineMotion?.presentationCardScaleFrom
            ?? presentationScale(sceneNode.presentationCardScale);
          existing.presentationOpacity = timelineMotion?.presentationOpacityFrom
            ?? presentationOpacity(sceneNode.presentationOpacity);
          this.rememberPlacement(sceneNode.id, desired);
          this.freezeNode(existing, timelineMotion?.from ?? desired);
          nextNodes.set(sceneNode.id, existing);
          return;
        }
        // Existing coordinates are authoritative. New graphData must never
        // overwrite an admitted node's position or its in-flight destination.
        if (sceneNode.kind !== "source") {
          this.rememberPlacement(
            sceneNode.id,
            existing.entry?.to ?? new THREE.Vector3(existing.x, existing.y, existing.z),
          );
        }
        existing.timelineMotion = undefined;
        existing.timelineOpacity = 1;
        existing.timelineScale = 1;
        existing.presentationScale = presentationScale(sceneNode.presentationScale);
        existing.presentationCardScale = presentationScale(sceneNode.presentationCardScale);
        existing.presentationOpacity = presentationOpacity(sceneNode.presentationOpacity);
        this.freezeNode(existing);
        nextNodes.set(sceneNode.id, existing);
        return;
      }
      const desired = sceneNode.kind === "source"
        ? currentSource
        : incrementalTargets.get(sceneNode.id) as THREE.Vector3;
      const expansionAnchorId = expansionAnchors.get(sceneNode.id);
      const expansionAnchor = expansionAnchorId
        ? oldNodes.get(expansionAnchorId)
        : undefined;
      const entryIndex = entryOrderById.get(sceneNode.id) ?? 0;
      const focusOrigin = expansionAnchor
        && (expansionAnchor.id === this.lockedId || expansionAnchor.id === this.selectedId)
        ? new THREE.Vector3(expansionAnchor.x, expansionAnchor.y, expansionAnchor.z)
        : persistentAnchor
          && persistentAnchor.kind !== "source"
          && persistentAnchor.sourceId === sceneNode.sourceId
          ? new THREE.Vector3(persistentAnchor.x, persistentAnchor.y, persistentAnchor.z)
          : currentSource.clone();
      const jitter = stableDirection(`${sceneNode.id}:entry-origin`).multiplyScalar(
        2.2 + stableUnit(`${sceneNode.id}:entry-jitter`) * 3.8,
      );
      const from = focusOrigin.add(jitter);
      const travel = desired.clone().sub(from);
      const travelDirection = travel.lengthSq() > 0.0001
        ? travel.clone().normalize()
        : new THREE.Vector3(1, 0, 0);
      const arc = stableDirection(`${sceneNode.id}:entry-arc`);
      arc.addScaledVector(travelDirection, -arc.dot(travelDirection));
      if (arc.lengthSq() < 0.0001) arc.set(-travelDirection.y, travelDirection.x, 0.24);
      arc.normalize().multiplyScalar(Math.min(16, 4 + travel.length() * 0.075));
      const timelineMotion = timelineMotionFor(sceneNode, desired);
      const entry = animateTimelineWindow || sceneNode.kind === "source" || this.reducedMotion
        ? undefined
        : {
            startedAt: entryNow + Math.min(
              440,
              entryIndex * 34 + (sceneNode.kind === "entity" ? 28 : 0),
            ),
            duration: 680 + stableUnit(`${sceneNode.id}:entry-duration`) * 160,
            from,
            to: desired.clone(),
            arc,
          };
      nextNodes.set(sceneNode.id, {
        id: sceneNode.id,
        kind: sceneNode.kind,
        sourceId: sceneNode.sourceId,
        sceneNode,
        x: timelineMotion?.from.x ?? entry?.from.x ?? desired.x,
        y: timelineMotion?.from.y ?? entry?.from.y ?? desired.y,
        z: timelineMotion?.from.z ?? entry?.from.z ?? desired.z,
        fx: timelineMotion?.from.x ?? entry?.from.x ?? desired.x,
        fy: timelineMotion?.from.y ?? entry?.from.y ?? desired.y,
        fz: timelineMotion?.from.z ?? entry?.from.z ?? desired.z,
        entry,
        entryOpacity: entry ? 0 : undefined,
        timelineMotion,
        timelineOpacity: timelineMotion?.opacityFrom ?? 1,
        timelineScale: timelineMotion?.scaleFrom ?? 1,
        presentationScale: timelineMotion?.presentationScaleFrom
          ?? presentationScale(sceneNode.presentationScale),
        presentationCardScale: timelineMotion?.presentationCardScaleFrom
          ?? presentationScale(sceneNode.presentationCardScale),
        presentationOpacity: timelineMotion?.presentationOpacityFrom
          ?? presentationOpacity(sceneNode.presentationOpacity),
        timelineRetiring: false,
      });
    });
    const retiringNodeIds = new Set<string>();
    const exitCamera = this.graph.camera() as THREE.PerspectiveCamera;
    exitCamera.updateMatrixWorld();
    const exitCameraRight = new THREE.Vector3()
      .setFromMatrixColumn(exitCamera.matrixWorld, 0)
      .normalize();
    const exitCameraUp = new THREE.Vector3()
      .setFromMatrixColumn(exitCamera.matrixWorld, 1)
      .normalize();
    const exitAspect = Math.max(
      0.4,
      this.host.clientWidth / Math.max(1, this.host.clientHeight),
    );
    const currentSourceNodes = new Map(
      [...oldNodes.values()]
        .filter((node) => node.kind === "source")
        .map((node) => [node.sourceId, node]),
    );
    const mobileScene = this.host.clientWidth < 768;
    const hardSceneBudget = mobileScene
      ? UNIVERSE_SCENE_BUDGET.mobile
      : UNIVERSE_SCENE_BUDGET.desktop;
    const configuredNodeBudget = mobileScene
      ? this.policy.node_budget_mobile
      : this.policy.node_budget_desktop;
    const configuredEdgeBudget = mobileScene
      ? this.policy.edge_budget_mobile
      : this.policy.edge_budget_desktop;
    const transitionNodeBudget = Math.min(
      hardSceneBudget.nodes,
      Math.max(
        0,
        Number.isFinite(configuredNodeBudget) ? Math.floor(configuredNodeBudget) : 0,
      ),
    );
    const transitionEdgeBudget = Math.min(
      hardSceneBudget.edges,
      Math.max(
        0,
        Number.isFinite(configuredEdgeBudget) ? Math.floor(configuredEdgeBudget) : 0,
      ),
    );
    let remainingGhostNodeCapacity = Math.max(
      0,
      transitionNodeBudget
        - [...nextNodes.values()].filter((node) => node.kind !== "source").length,
    );
    let droppedGhostNodeCount = 0;
    oldNodes.forEach((node, id) => {
      if (nextNodes.has(id)) return;
      if (!animateTimelineWindow || this.reducedMotion || node.kind === "source") {
        this.detachSharedNodeResources(node);
        return;
      }
      if (remainingGhostNodeCapacity <= 0) {
        droppedGhostNodeCount += 1;
        this.detachSharedNodeResources(node);
        return;
      }
      remainingGhostNodeCapacity -= 1;
      const from = new THREE.Vector3(node.x, node.y, node.z);
      const source = currentSourceNodes.get(node.sourceId);
      const depthPoint = source ?? node;
      const distance = exitCamera.position.distanceTo(
        new THREE.Vector3(depthPoint.x, depthPoint.y, depthPoint.z),
      );
      const worldHeight = 2 * distance
        * Math.tan(THREE.MathUtils.degToRad(exitCamera.fov) / 2);
      const side = this.timelineExitSide(node);
      const currentOpacity = node.timelineOpacity ?? 1;
      const currentScale = node.timelineScale ?? 1;
      node.entry = undefined;
      node.entryOpacity = undefined;
      node.timelineRetiring = true;
      node.timelineOpacity = currentOpacity;
      node.timelineScale = currentScale;
      const motionGroupId = node.sceneNode.timelineBundleId ?? node.id;
      const collapseTarget = timelineTransitionOrigin.clone().add(
        stableDirection(`${motionGroupId}:timeline-collapse`).multiplyScalar(2.4),
      );
      // Under flight a retired package dissolves where it stands: the camera
      // is moving, so any scripted fly-out would read as the world lurching.
      const dissolveInPlace = this.flightConfig !== null;
      node.timelineMotion = {
        kind: "exit",
        startedAt: entryNow,
        duration: dissolveInPlace
          ? TIMELINE_DISSOLVE_MS
          : TIMELINE_EXIT_MIN_MS
            + stableUnit(`${node.id}:timeline-exit-duration`) * TIMELINE_EXIT_VARIANCE_MS,
        from,
        to: dissolveInPlace
          ? from.clone()
          : windowDirection === "previous"
            ? collapseTarget
            : from.clone()
                .addScaledVector(exitCameraRight, side * worldHeight * exitAspect * 0.58)
                .addScaledVector(
                  exitCameraUp,
                  (stableUnit(`${node.id}:timeline-exit-rise`) - 0.5) * worldHeight * 0.1,
                ),
        arc: dissolveInPlace
          ? new THREE.Vector3()
          : exitCameraUp.clone().multiplyScalar(
              (stableUnit(`${motionGroupId}:timeline-exit-arc`) - 0.5) * worldHeight * 0.07,
            ),
        opacityFrom: currentOpacity,
        opacityTo: 0,
        scaleFrom: currentScale,
        scaleTo: dissolveInPlace
          ? Math.max(0.3, currentScale * 0.6)
          : windowDirection === "previous"
            ? 0.12
            : Math.max(0.08, currentScale * 0.42),
        presentationScaleFrom: currentNodePresentationScale(node),
        presentationScaleTo: currentNodePresentationScale(node),
        presentationCardScaleFrom: currentNodePresentationCardScale(node),
        presentationCardScaleTo: currentNodePresentationCardScale(node),
        presentationOpacityFrom: currentNodePresentationOpacity(node),
        presentationOpacityTo: currentNodePresentationOpacity(node),
      };
      retiringNodeIds.add(id);
      nextNodes.set(id, node);
    });
    this.host.dataset.universeTransitionNodeBudget = String(transitionNodeBudget);
    this.host.dataset.universeTransitionEdgeBudget = String(transitionEdgeBudget);
    this.host.dataset.universeRetainedGhostNodeCount = String(retiringNodeIds.size);
    this.host.dataset.universeDroppedGhostNodeCount = String(droppedGhostNodeCount);

    this.nodes = nextNodes;
    this.sourceHits = sourceHits;
    if (this.lockedId && !nextNodes.has(this.lockedId)) {
      this.lockedId = null;
      this.host.dataset.universeLockedId = "";
    }
    if (this.selectedId && !nextNodes.has(this.selectedId)) this.selectedId = null;
    if (this.hoveredId && !nextNodes.has(this.hoveredId)) {
      this.cancelHoverClear();
      this.hoveredId = null;
      this.hoveredFromLabel = false;
      this.callbacks.onHover(null);
    }
    if (this.keyboardFocusedId && !nextNodes.has(this.keyboardFocusedId)) {
      this.clearKeyboardFocus(true, false);
    }
    this.host.dataset.universeSelectedId = this.selectedId ?? "";
    this.clusterNodes = [...nextNodes.values()];

    const previousLinks = this.links;
    const oldLinks = new Map(previousLinks.map((link) => [link.id, link]));
    const nextLinks = data.links
      .filter((link) => nextNodes.has(link.source) && nextNodes.has(link.target) && !link.virtual)
      .map((sceneLink) => {
        const existing = oldLinks.get(sceneLink.id);
        if (existing) {
          oldLinks.delete(sceneLink.id);
          existing.sourceId = sceneLink.source;
          existing.targetId = sceneLink.target;
          existing.sceneLink = sceneLink;
          existing.visible = true;
          existing.highlighted = false;
          existing.timelineRetiring = false;
          return existing;
        }
        return {
          id: sceneLink.id,
          source: sceneLink.source,
          target: sceneLink.target,
          sourceId: sceneLink.source,
          targetId: sceneLink.target,
          sceneLink,
          visible: true,
          highlighted: false,
          timelineRetiring: false,
        };
      });
    let remainingGhostLinkCapacity = Math.max(
      0,
      transitionEdgeBudget - nextLinks.length,
    );
    let retainedGhostLinkCount = 0;
    let droppedGhostLinkCount = 0;
    if (animateTimelineWindow) {
      oldLinks.forEach((link, id) => {
        const sourceId = link.sourceId || endpointId(link.source);
        const targetId = link.targetId || endpointId(link.target);
        if (
          !nextNodes.has(sourceId)
          || !nextNodes.has(targetId)
          || (!retiringNodeIds.has(sourceId) && !retiringNodeIds.has(targetId))
        ) return;
        if (remainingGhostLinkCapacity <= 0) {
          droppedGhostLinkCount += 1;
          return;
        }
        remainingGhostLinkCapacity -= 1;
        retainedGhostLinkCount += 1;
        link.sourceId = sourceId;
        link.targetId = targetId;
        link.visible = true;
        link.highlighted = false;
        link.timelineRetiring = true;
        nextLinks.push(link);
        oldLinks.delete(id);
      });
    }
    this.host.dataset.universeRetainedGhostLinkCount = String(retainedGhostLinkCount);
    this.host.dataset.universeDroppedGhostLinkCount = String(droppedGhostLinkCount);
    this.links = nextLinks;
    this.rebuildAdjacency();
    this.visibleEdgeIds = new Set(this.links.map((link) => link.id));
    this.links.forEach((link) => {
      link.visible = true;
    });

    const topologyChanged = planUniverseSceneDelta(
      oldNodes.keys(),
      nextNodes.keys(),
    ).topologyChanged || planUniverseSceneDelta(
      previousLinks.map((link) => link.id),
      this.links.map((link) => link.id),
    ).topologyChanged;
    this.host.dataset.universeTopologyChanged = String(topologyChanged);
    if (topologyChanged) {
      this.graph.graphData({ nodes: [...nextNodes.values()], links: this.links });
      oldLinks.forEach((link) => {
        // three-forcegraph synchronously disposes removed line objects. Drop our
        // data-side reference without disposing the same material a second time.
        link.lineMaterial = undefined;
      });
    }
    this.syncFrozenNodeCoordinates();
    const enteringCount = [...nextNodes.values()].filter((node) => node.entry).length;
    const timelineMovingCount = [...nextNodes.values()].filter(
      (node) => node.timelineMotion,
    ).length;
    this.host.dataset.universeEnteringCount = String(enteringCount);
    this.host.dataset.universeTimelineMovingCount = String(timelineMovingCount);
    this.host.dataset.universeRetiringNodeCount = String(retiringNodeIds.size);
    this.updatePixelRatio();
    this.dataReady = true;
    if (this.initialFocusTimer !== null) window.clearTimeout(this.initialFocusTimer);
    this.initialFocusTimer = window.setTimeout(() => {
      this.initialFocusTimer = null;
      if (!this.interactive || this.paused) return;
      if (!this.didInitialFocus) {
        this.didInitialFocus = true;
        window.requestAnimationFrame(() => {
          if (this.sourceHits[0]?.source_id) this.focusSource(this.sourceHits[0].source_id);
          else this.focusOverview();
        });
      }
    }, 48);
    this.host.dataset.universeRenderedRelations = String(this.visibleEdgeIds.size);
    this.host.dataset.universeHighlightedRelations = "0";
    this.host.dataset.universeRelationAnchor = "";
    this.host.dataset.universeEngine = "3d-force-graph";
    this.host.dataset.universeNodeCount = String(data.nodes.length);
    this.host.dataset.universeLinkCount = String(data.links.length);
    this.host.dataset.universeEventStarCount = String(
      [...nextNodes.values()].filter((node) => node.kind === "event").length,
    );
    this.host.dataset.universeEntityGlyphCount = String(
      [...nextNodes.values()].filter((node) => node.kind === "entity").length,
    );
    this.updateTemporalPresence();
    this.updateVisualLayout(performance.now(), true, false);
    this.rebuildNebula();
    this.syncNebulaCorridorUniforms();
    this.rebuildLabels();
    this.applyHighlight();
    if (this.timelineMotionPhase === "entering" && timelineMovingCount === 0) {
      this.finishTimelineMotionPhase();
    }
    if (!this.paused && searchFocusSourceId) this.focusSource(searchFocusSourceId);
    if (!this.paused) {
      const animatingData = enteringCount > 0 || timelineMovingCount > 0;
      const entryClock = performance.now();
      const entryKeepAliveMs = [...nextNodes.values()].reduce((latest, node) => {
        const motion = node.timelineMotion ?? node.entry;
        if (!motion) return latest;
        return Math.max(
          latest,
          motion.startedAt + motion.duration - entryClock,
        );
      }, 0) + 160;
      this.wakeRendering(animatingData ? entryKeepAliveMs : 480);
      if (animatingData) this.startLoop(entryKeepAliveMs);
    }
  }

  focusOverview() {
    this.frameOverview(760, false);
  }

  /**
   * Clears transient exploration presentation without discarding the loaded
   * working set. The canonical, zero-duration camera move is important when
   * the workspace covers the universe: the renderer can then sleep on a
   * deterministic overview frame instead of preserving an off-screen orbit.
   */
  resetOverview() {
    this.cancelTimelineTransition(true);
    this.releaseLockedNode(false);
    this.clearKeyboardFocus(true, false);
    if (this.hoveredId) this.handleNodeHover(null, false, true);
    this.selectedId = null;
    this.pointerActive = false;
    this.latchedDetailSourceId = null;
    this.visualSourceId = null;
    this.visualDetailMix = 0;
    this.visualDetailTarget = 0;
    this.reportedViewSourceId = null;
    this.requestedSourceId = null;
    this.overviewRequested = true;
    this.pendingLod = null;
    this.lodArmed = false;
    this.lodLevels.clear();
    this.deepLodMilestones.clear();
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    this.lodTimer = null;
    this.host.dataset.universeSelectedId = "";
    this.host.dataset.universeVisualMode = "overview";
    this.host.dataset.universeDetailSource = "";
    this.host.dataset.universeDetailLatched = "";
    this.host.dataset.universeDetailMix = "0.00";
    this.host.dataset.universeDetailTarget = "0.00";
    this.host.dataset.universeResetState = "overview";
    this.frameOverview(0, true);
    this.updateNodeMorphScales(performance.now(), true);
    this.updateSourceAuraOpacities();
    this.updateNebulaMotionState();
    this.rebuildLabels();
    this.applyHighlight();
    this.graph.renderer().render(this.graph.scene(), this.graph.camera());
    this.callbacks.onViewChange({ mode: "overview", sourceId: null, progress: 0 });
  }

  private frameOverview(duration: number, canonical: boolean) {
    this.requestedSourceId = null;
    this.overviewRequested = true;
    this.host.dataset.universeCameraTarget = "overview";
    const sources = [...this.nodes.values()].filter((node) => node.kind === "source");
    if (!sources.length) return;
    const bounds = new THREE.Box3();
    sources.forEach((node) => {
      const radius = Math.max(30, node.sceneNode.radius * 1.12);
      bounds.expandByPoint(new THREE.Vector3(node.x - radius, node.y - radius, node.z - radius));
      bounds.expandByPoint(new THREE.Vector3(node.x + radius, node.y + radius, node.z + radius));
    });
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const camera = this.graph.camera() as THREE.PerspectiveCamera;
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const aspect = Math.max(0.4, this.host.clientWidth / Math.max(1, this.host.clientHeight));
    // A flat bounding box underestimates the required distance when a large
    // source sits closer to the canonical camera. Include each source's depth
    // offset so its full projected radius remains inside the initial frame.
    const distanceY = Math.max(...sources.map((node) => {
      const radius = Math.max(30, node.sceneNode.radius * 1.12);
      const depthOffset = node.z - center.z;
      const extent = Math.abs(node.y - center.y) + radius;
      return depthOffset + extent / Math.max(0.01, halfFov);
    }));
    const distanceX = Math.max(...sources.map((node) => {
      const radius = Math.max(30, node.sceneNode.radius * 1.12);
      const depthOffset = node.z - center.z;
      const extent = Math.abs(node.x - center.x) + radius;
      return depthOffset + extent / Math.max(0.01, halfFov * aspect);
    }));
    const distance = Math.max(420, distanceX, distanceY, size.z * 1.4) * 1.2;
    this.host.dataset.universeBounds = [
      bounds.min.x.toFixed(1),
      bounds.max.x.toFixed(1),
      bounds.min.y.toFixed(1),
      bounds.max.y.toFixed(1),
      bounds.min.z.toFixed(1),
      bounds.max.z.toFixed(1),
    ].join(",");
    this.moveCamera(center, distance, duration, false, canonical);
  }

  focusSource(sourceId: string) {
    const node = [...this.nodes.values()].find(
      (candidate) => candidate.kind === "source" && candidate.sourceId === sourceId,
    );
    if (!node) return;
    const sourceChanged = this.visualSourceId !== sourceId;
    const reportedChanged = this.reportedViewSourceId !== sourceId;
    this.requestedSourceId = sourceId;
    this.latchedDetailSourceId = sourceId;
    this.visualSourceId = sourceId;
    this.overviewRequested = false;
    this.host.dataset.universeResetState = "";
    this.host.dataset.universeCameraTarget = `source:${sourceId}`;
    this.host.dataset.universeDetailLatched = sourceId;
    if (this.visualDetailMix >= 0.5) {
      this.reportedViewSourceId = sourceId;
      this.host.dataset.universeVisualMode = "detail";
      this.host.dataset.universeDetailSource = sourceId;
      if (reportedChanged) {
        this.callbacks.onViewChange({
          mode: "detail",
          sourceId,
          progress: this.visualDetailMix,
        });
      }
    }
    if (sourceChanged) {
      this.rebuildLabels();
      this.applyHighlight();
    }
    // Entering a browse session is a dive, not a dolly: the camera flies in
    // through the nebula shell and settles at the corridor entrance looking
    // down the counting axis, while the detail morph stretches the dust into
    // the corridor around it. Layer by layer, like the knowledge it carries.
    const flight = this.flightConfig;
    if (flight && flight.sourceId === sourceId) {
      const entryZ = flight.centerZ - this.appliedFlightDepth;
      // The arrival is the hero pose: stand far enough back that the intact
      // galaxy fills the frame like the brand site's first screen, then let
      // the wheel carry the camera through it into the corridor.
      const heroStandoff = Math.min(
        560,
        Math.max(CORRIDOR_ENTRY_STANDOFF, node.sceneNode.radius * 1.45 * 1.9),
      );
      const lookAt = new THREE.Vector3(
        node.x + CORRIDOR_ENTRY_LATERAL_X * 0.35,
        node.y + CORRIDOR_ENTRY_LATERAL_Y * 0.35,
        entryZ - CORRIDOR_ENTRY_LOOK_AHEAD,
      );
      const position = new THREE.Vector3(
        node.x + CORRIDOR_ENTRY_LATERAL_X,
        node.y + CORRIDOR_ENTRY_LATERAL_Y,
        entryZ + heroStandoff,
      );
      this.pointerActive = false;
      this.lodArmed = false;
      if (this.hoveredId) this.handleNodeHover(null, false, true);
      const duration = this.reducedMotion ? 0 : CORRIDOR_ENTRY_MS;
      this.wakeRendering(duration + 900);
      this.host.dataset.universeCamera = [
        position.x.toFixed(1),
        position.y.toFixed(1),
        position.z.toFixed(1),
        lookAt.x.toFixed(1),
        lookAt.y.toFixed(1),
        lookAt.z.toFixed(1),
      ].join(",");
      this.graph.cameraPosition(
        { x: position.x, y: position.y, z: position.z },
        { x: lookAt.x, y: lookAt.y, z: lookAt.z },
        duration,
      );
      this.startLoop(duration + 180);
      // Lock the gaze cone only after the dive lands, so the approach itself
      // may start from any bearing without snapping.
      if (this.browseGazeTimer !== null) window.clearTimeout(this.browseGazeTimer);
      this.browseGazeTimer = window.setTimeout(() => {
        this.browseGazeTimer = null;
        if (!this.paused && this.flightConfig?.sourceId === sourceId) {
          this.applyBrowseGaze();
        }
      }, duration + 80);
      return;
    }
    const concreteNodes = [...this.nodes.values()].filter(
      (candidate) =>
        candidate.kind !== "source"
        && candidate.sourceId === sourceId
        && candidate.sceneNode.state === "active"
        && Number.isFinite(candidate.x)
        && Number.isFinite(candidate.y)
        && Number.isFinite(candidate.z),
    );
    if (concreteNodes.length) {
      const bounds = new THREE.Box3();
      concreteNodes.forEach((candidate) => {
        const padding = candidate.kind === "event" ? 22 : 12;
        // Admission begins at the source core, so fitting the current animated
        // coordinate would zoom into a temporary cluster and let the finished
        // network expand off-screen. Always frame the stable destination.
        const position = candidate.entry?.to ?? candidate;
        bounds.expandByPoint(new THREE.Vector3(
          position.x - padding,
          position.y - padding,
          position.z - padding,
        ));
        bounds.expandByPoint(new THREE.Vector3(
          position.x + padding,
          position.y + padding,
          position.z + padding,
        ));
      });
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const camera = this.graph.camera() as THREE.PerspectiveCamera;
      const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const aspect = Math.max(0.4, this.host.clientWidth / Math.max(1, this.host.clientHeight));
      const distanceY = size.y / Math.max(0.01, 2 * halfFov);
      const distanceX = size.x / Math.max(0.01, 2 * halfFov * aspect);
      const distance = Math.max(150, distanceX, distanceY, size.z * 1.32) * 0.9;
      this.moveCamera(center, distance, 620);
      return;
    }
    this.moveCamera(
      new THREE.Vector3(node.x, node.y, node.z),
      Math.max(250, node.sceneNode.radius * 3.25),
      620,
    );
  }

  focusResult() {
    const primarySource = this.sourceHits[0]?.source_id;
    if (primarySource) {
      this.focusSource(primarySource);
      return;
    }
    if (this.selectedId) {
      this.focusNode(this.selectedId);
      return;
    }
    this.focusOverview();
  }

  focusNode(nodeId: string) {
    this.overviewRequested = false;
    this.host.dataset.universeResetState = "";
    this.host.dataset.universeCameraTarget = `node:${nodeId}`;
    const node = this.nodes.get(nodeId);
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
      return;
    }
    // Focusing moves the camera on its own, so the flight's notion of depth
    // must follow — otherwise window-follow would tug the window back toward
    // wherever the camera used to be.
    const config = this.flightConfig;
    if (config && node.kind !== "source" && node.sourceId === config.sourceId) {
      const depth = THREE.MathUtils.clamp(
        config.centerZ - node.z,
        0,
        config.maxDepth,
      );
      this.flightState = createUniverseTemporalFlightState(depth);
      this.appliedFlightDepth = depth;
      // The depth jumped without a flight frame; presence must follow now or
      // the focused neighborhood keeps the dimness of the old camera position.
      this.updateTemporalPresence();
    }
    this.moveCamera(new THREE.Vector3(node.x, node.y, node.z), 112, 480);
  }

  lockNode(nodeId: string) {
    const node = this.nodes.get(nodeId);
    if (
      !node
      || node.kind === "source"
      || !Number.isFinite(node.x)
      || !Number.isFinite(node.y)
      || !Number.isFinite(node.z)
    ) return;
    if (this.lockedId !== nodeId) this.releaseLockedNode(false);
    this.lockedId = nodeId;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
    this.host.dataset.universeLockedId = nodeId;
    this.rebuildLabels();
    this.pinNode(node);
  }

  unlockNode() {
    this.releaseLockedNode();
  }

  /**
   * Clears every interaction focus in one scene transaction. This deliberately
   * leaves graph data, deterministic positions and the camera untouched so a
   * blank-canvas click feels like dismissing a popover, not reloading a graph.
   */
  clearSelection() {
    const changed = Boolean(
      this.lockedId
      || this.selectedId
      || this.hoveredId
      || this.keyboardFocusedId,
    );
    if (!changed) return;
    const lockedNode = this.lockedId ? this.nodes.get(this.lockedId) : undefined;
    if (lockedNode) this.freezeNode(lockedNode);
    this.cancelHoverClear();
    this.cancelHoverLabelRebuild();
    this.lockedId = null;
    this.selectedId = null;
    this.hoveredId = null;
    this.hoveredFromLabel = false;
    this.keyboardFocusedId = null;
    this.host.dataset.universeLockedId = "";
    this.host.dataset.universeSelectedId = "";
    this.host.dataset.universeKeyboardNodeId = "";
    this.updateKeyboardStatus([]);
    this.callbacks.onHover(null);
    if (!this.dataReady) return;
    this.rebuildLabels();
    this.applyHighlight();
    this.wakeRendering(480);
  }

  pause() {
    this.paused = true;
    this.keyboardActive = false;
    this.host.dataset.universeKeyboardActive = "false";
    this.clearKeyboardFocus(false, false);
    this.cancelHoverClear();
    this.cancelHoverLabelRebuild();
    this.loopKeepAliveUntil = 0;
    this.nebulaAnimationUntil = 0;
    this.host.dataset.universeLoop = "idle";
    this.host.dataset.universeNebulaMotion = "idle";
    this.host.dataset.universePaused = "true";
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    if (this.initialFocusTimer !== null) window.clearTimeout(this.initialFocusTimer);
    this.sleepTimer = null;
    this.lodTimer = null;
    this.initialFocusTimer = null;
    this.pendingLod = null;
    this.lodArmed = false;
    this.pointerActive = false;
    this.flightState = brakeUniverseTemporalFlight(this.flightState);
    this.hoveredId = null;
    this.hoveredFromLabel = false;
    this.clearHighlightFlowSprites();
    this.renderingAwake = false;
    this.host.dataset.universeRenderer = "sleeping";
    this.graph.pauseAnimation();
    if (this.loopFrame !== null) cancelAnimationFrame(this.loopFrame);
    this.loopFrame = null;
  }

  resume() {
    if (!this.interactive || !this.dataReady || document.visibilityState !== "visible") return;
    this.paused = false;
    this.host.dataset.universePaused = "false";
    if (this.resizePending) this.handleResize();
    if (this.labelFocusId() !== this.renderedLabelFocusId) this.rebuildLabels();
    if (this.dataReady) this.applyHighlight();
    this.wakeRendering(1200);
    this.startLoop(120);
    this.armNebulaAnimation();
  }

  dispose() {
    this.cancelTimelineTransition(true);
    this.pause();
    this.cancelHoverLabelRebuild();
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    if (this.initialFocusTimer !== null) window.clearTimeout(this.initialFocusTimer);
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    if (this.browseGazeTimer !== null) window.clearTimeout(this.browseGazeTimer);
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.controls.removeEventListener("change", this.handleControlsChange);
    this.resizeObserver.disconnect();
    this.host.removeEventListener("pointermove", this.handlePointerMove);
    this.host.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.host.removeEventListener("wheel", this.handleTimelineWheel, true);
    this.host.removeEventListener("pointerenter", this.handlePointerEnter);
    this.host.removeEventListener("pointerleave", this.handlePointerLeave);
    this.host.removeEventListener("focus", this.handleCanvasFocus);
    this.host.removeEventListener("blur", this.handleCanvasBlur);
    this.host.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("pointermove", this.handleWindowPointerMove);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.rendererCanvas.removeEventListener("webglcontextlost", this.handleWebglContextLost);
    this.clearNebula();
    this.clearHighlightFlowSprites();
    this.highlightFlowMaterial.dispose();
    this.nodes.forEach((node) => this.detachSharedNodeResources(node));
    this.graph._destructor();
    this.links.forEach((link) => {
      link.lineMaterial = undefined;
    });
    this.eventTexture.dispose();
    this.eventCoreTexture.dispose();
    this.entityTexture.dispose();
    this.entityCoreTexture.dispose();
    this.sourceTexture.dispose();
    this.sourceHitGeometry.dispose();
    this.host.replaceChildren();
  }

  private detachSharedNodeResources(node: ForceNode) {
    const object = node.object;
    if (!object) return;
    // graphData removes node objects synchronously, but the renderer/raycaster
    // can still hold the previous object list for the current frame. Quarantine
    // the object before clearing its shared geometry/texture references so a
    // FIFO eviction can never expose an object with `geometry === undefined`.
    object.visible = false;
    object.removeFromParent();
    object.traverse((child) => {
      child.visible = false;
      child.raycast = () => undefined;
      const candidate = child as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      // three-forcegraph owns each node object and recursively deallocates it
      // when graphData drops the node. Sprites share Three's module-level quad,
      // while hit meshes and textures are engine-owned singletons. Detach those
      // shared references so removing one FIFO node cannot invalidate survivors.
      if (child instanceof THREE.Sprite || candidate.geometry === this.sourceHitGeometry) {
        candidate.geometry = undefined;
      }
      if (!candidate.material) return;
      const materials = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material];
      materials.forEach((material) => {
        const mapped = material as THREE.Material & { map?: THREE.Texture | null };
        if (
          mapped.map === this.eventTexture
          || mapped.map === this.eventCoreTexture
          || mapped.map === this.entityTexture
          || mapped.map === this.entityCoreTexture
          || mapped.map === this.sourceTexture
        ) mapped.map = null;
      });
    });
    node.object = undefined;
  }

  private makeClusterForce(): ClusterForce {
    const force = ((alpha: number) => {
      const sources = new Map(
        this.clusterNodes
          .filter((node) => node.kind === "source")
          .map((node) => [node.sourceId, node]),
      );
      this.clusterNodes.forEach((node) => {
        if (node.kind === "source") return;
        const source = sources.get(node.sourceId);
        if (!source) return;
        const strength = node.kind === "event" ? 0.012 : 0.018;
        node.vx = (node.vx ?? 0) + (source.x - node.x) * strength * alpha;
        node.vy = (node.vy ?? 0) + (source.y - node.y) * strength * alpha;
        node.vz = (node.vz ?? 0) + (source.z - node.z) * strength * alpha;
      });
    }) as ClusterForce;
    force.initialize = (nodes) => {
      this.clusterNodes = nodes;
    };
    return force;
  }

  private freezeNode(
    node: ForceNode,
    position: Pick<THREE.Vector3, "x" | "y" | "z"> = node,
  ) {
    const { x, y, z } = position;
    node.x = x;
    node.y = y;
    node.z = z;
    node.fx = x;
    node.fy = y;
    node.fz = z;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
  }

  private rememberPlacement(nodeId: string, position: Pick<THREE.Vector3, "x" | "y" | "z">) {
    this.placementTargets.delete(nodeId);
    this.placementTargets.set(nodeId, new THREE.Vector3(position.x, position.y, position.z));
    while (this.placementTargets.size > MAX_PLACEMENT_MEMORY) {
      const oldest = this.placementTargets.keys().next().value;
      if (typeof oldest !== "string") break;
      this.placementTargets.delete(oldest);
    }
    this.host.dataset.universePlacementMemory = String(this.placementTargets.size);
  }

  private syncFrozenNodeCoordinates() {
    this.nodes.forEach((node) => {
      node.x = node.fx;
      node.y = node.fy;
      node.z = node.fz;
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
    });
    this.syncGraphObjectPositions();
    this.host.dataset.universeFrozenNodeCount = String(this.nodes.size);
    this.host.dataset.universeLayoutStable = "true";
  }

  private syncGraphObjectPositions() {
    this.nodes.forEach((node) => {
      node.object?.position.set(node.x, node.y, node.z);
    });
    this.links.forEach((link) => {
      const linkObject = link.__lineObj;
      const source = this.nodes.get(link.sourceId);
      const target = this.nodes.get(link.targetId);
      if (!linkObject || !source || !target) return;
      const line = linkObject.children[0] ?? linkObject;
      if (!(line instanceof THREE.Mesh)) return;
      const start = this.linkStart.set(source.x, source.y, source.z);
      const end = this.linkEnd.set(target.x, target.y, target.z);
      line.position.copy(start);
      line.scale.z = start.distanceTo(end);
      this.linkWorldEnd.copy(end);
      line.parent?.localToWorld(this.linkWorldEnd);
      line.lookAt(this.linkWorldEnd);
      line.updateMatrix();
    });
  }

  private updateNodeEntries(now: number) {
    let entering = 0;
    let hadEntry = false;
    this.nodes.forEach((node) => {
      const entry = node.entry;
      if (!entry) return;
      hadEntry = true;
      const progress = THREE.MathUtils.clamp(
        (now - entry.startedAt) / entry.duration,
        0,
        1,
      );
      if (progress >= 1) {
        this.freezeNode(node, entry.to);
        node.entry = undefined;
        node.entryOpacity = undefined;
        node.renderedEntryOpacity = undefined;
        this.setObjectOpacity(
          node,
          node.visualOpacity ?? 1,
          node.visuallyEmphasized ?? false,
        );
        return;
      }
      entering += 1;
      const eased = easeOutCubic(progress);
      const arcWeight = Math.sin(Math.PI * progress);
      this.freezeNode(node, {
        x: THREE.MathUtils.lerp(entry.from.x, entry.to.x, eased) + entry.arc.x * arcWeight,
        y: THREE.MathUtils.lerp(entry.from.y, entry.to.y, eased) + entry.arc.y * arcWeight,
        z: THREE.MathUtils.lerp(entry.from.z, entry.to.z, eased) + entry.arc.z * arcWeight,
      });
      node.entryOpacity = progress;
      this.setObjectOpacity(
        node,
        node.visualOpacity ?? 1,
        node.visuallyEmphasized ?? false,
      );
    });
    if (hadEntry) {
      this.syncGraphObjectPositions();
      this.updateLinkVisuals();
    }
    this.host.dataset.universeEnteringCount = String(entering);
    return entering > 0;
  }

  private cancelNodeEntry(node: ForceNode) {
    const entry = node.entry;
    if (!entry) return;
    // An interrupted entrance commits its deterministic destination instead of
    // preserving a pointer-timing-dependent intermediate coordinate.
    this.freezeNode(node, entry.to);
    node.entry = undefined;
    node.entryOpacity = undefined;
    node.renderedEntryOpacity = undefined;
    this.setObjectOpacity(
      node,
      node.visualOpacity ?? 1,
      node.visuallyEmphasized ?? false,
    );
    this.syncGraphObjectPositions();
    this.host.dataset.universeEnteringCount = String(
      [...this.nodes.values()].filter((item) => item.entry).length,
    );
  }

  private timelineIsBusy() {
    return this.timelineIntentPending
      || this.timelineMotionPhase !== "idle"
      || this.timelineJourney.phase === "loading"
      || this.timelineJourney.phase === "transitioning";
  }

  private shouldCancelTimelineIntentForWindowChange(
    cause: NonNullable<UniverseSceneData["windowChangeCause"]>,
  ) {
    if (cause === "journey") return false;
    return this.timelineMotionPhase === "awaiting-result"
      || this.timelineMotionPhase === "awaiting-data";
  }

  private syncTimelineDiagnostics() {
    const busy = this.timelineIsBusy();
    this.host.dataset.universeTimelineEnabled = String(this.timelineJourney.enabled);
    this.host.dataset.universeTimelinePhase = this.timelineJourney.phase;
    this.host.dataset.universeTimelineInternalPhase = this.timelineMotionPhase;
    this.host.dataset.universeTimelineHasNext = String(this.timelineJourney.hasNext);
    this.host.dataset.universeTimelineHasPrevious = String(
      this.timelineJourney.hasPrevious,
    );
    this.host.dataset.universeTimelineExhausted = String(
      this.timelineJourney.networkExhausted,
    );
    this.host.dataset.universeTimelineRevision = String(this.timelineJourney.revision);
    this.host.dataset.universeTimelineBusy = String(busy);
    this.labels.forEach((label) => {
      if (label.primary) label.primary.disabled = busy;
      else if (label.element instanceof HTMLButtonElement) label.element.disabled = busy;
      label.actionButtons?.forEach((button, index) => {
        const node = this.nodes.get(label.nodeId);
        button.disabled = busy || (
          index === 0 && node?.sceneNode.canExploreMore === false
        );
      });
    });
  }

  private pruneRetiringTimelineElements() {
    const retiringIds = new Set(
      [...this.nodes.values()]
        .filter((node) => node.timelineRetiring)
        .map((node) => node.id),
    );
    if (retiringIds.size === 0) return;
    const previousLinks = this.links;
    const nextNodes = new Map<string, ForceNode>();
    this.nodes.forEach((node, id) => {
      if (retiringIds.has(id)) {
        this.detachSharedNodeResources(node);
        return;
      }
      nextNodes.set(id, node);
    });
    const nextLinks = previousLinks.filter((link) =>
      nextNodes.has(link.sourceId) && nextNodes.has(link.targetId));
    this.nodes = nextNodes;
    this.links = nextLinks;
    this.clusterNodes = [...nextNodes.values()];
    this.rebuildAdjacency();
    this.visibleEdgeIds = new Set(nextLinks.map((link) => link.id));
    this.graph.graphData({ nodes: [...nextNodes.values()], links: nextLinks });
    previousLinks.forEach((link) => {
      if (!nextLinks.includes(link)) link.lineMaterial = undefined;
    });
    this.syncFrozenNodeCoordinates();
    this.host.dataset.universeRenderedRelations = String(this.visibleEdgeIds.size);
    this.host.dataset.universeEventStarCount = String(
      [...nextNodes.values()].filter((node) => node.kind === "event").length,
    );
    this.host.dataset.universeEntityGlyphCount = String(
      [...nextNodes.values()].filter((node) => node.kind === "entity").length,
    );
    this.host.dataset.universeRetiringNodeCount = "0";
    this.host.dataset.universeRetainedGhostNodeCount = "0";
    this.host.dataset.universeRetainedGhostLinkCount = "0";
    this.rebuildLabels();
    this.applyHighlight();
  }

  private finishTimelineMotionPhase() {
    if (this.timelineMotionPhase !== "entering") return;
    this.pruneRetiringTimelineElements();
    this.timelineMotionPhase = "idle";
    this.timelineIntentPending = false;
    this.timelineIntentDirection = null;
    this.controls.enableZoom = this.interactive;
    this.host.dataset.universeTimelineMovingCount = "0";
    this.syncTimelineDiagnostics();
    this.callbacks.onTimelineSettled(this.timelineJourney.revision);
  }

  private updateTimelineMotions(now: number) {
    let moving = 0;
    let touched = false;
    this.nodes.forEach((node) => {
      const motion = node.timelineMotion;
      if (!motion) return;
      touched = true;
      const progress = THREE.MathUtils.clamp(
        (now - motion.startedAt) / Math.max(1, motion.duration),
        0,
        1,
      );
      const eased = easeTimelineMotion(progress);
      if (progress >= 1) {
        this.freezeNode(node, motion.to);
        node.timelineOpacity = motion.opacityTo;
        node.timelineScale = motion.scaleTo;
        node.presentationScale = motion.presentationScaleTo;
        node.presentationCardScale = motion.presentationCardScaleTo;
        node.presentationOpacity = motion.presentationOpacityTo;
        node.timelineMotion = undefined;
      } else {
        moving += 1;
        const arcWeight = Math.sin(Math.PI * progress);
        this.freezeNode(node, {
          x: THREE.MathUtils.lerp(motion.from.x, motion.to.x, eased)
            + motion.arc.x * arcWeight,
          y: THREE.MathUtils.lerp(motion.from.y, motion.to.y, eased)
            + motion.arc.y * arcWeight,
          z: THREE.MathUtils.lerp(motion.from.z, motion.to.z, eased)
            + motion.arc.z * arcWeight,
        });
        node.timelineOpacity = THREE.MathUtils.lerp(
          motion.opacityFrom,
          motion.opacityTo,
          eased,
        );
        node.timelineScale = THREE.MathUtils.lerp(
          motion.scaleFrom,
          motion.scaleTo,
          eased,
        );
        node.presentationScale = THREE.MathUtils.lerp(
          motion.presentationScaleFrom,
          motion.presentationScaleTo,
          eased,
        );
        node.presentationCardScale = THREE.MathUtils.lerp(
          motion.presentationCardScaleFrom,
          motion.presentationCardScaleTo,
          eased,
        );
        node.presentationOpacity = THREE.MathUtils.lerp(
          motion.presentationOpacityFrom,
          motion.presentationOpacityTo,
          eased,
        );
      }
      node.renderedEntryOpacity = undefined;
      this.setObjectOpacity(
        node,
        node.visualOpacity ?? 1,
        node.visuallyEmphasized ?? false,
      );
    });
    if (touched) {
      this.syncGraphObjectPositions();
      this.updateLinkVisuals();
    }
    this.host.dataset.universeTimelineMovingCount = String(moving);
    if (touched && moving === 0) {
      if (this.timelineMotionPhase === "entering") this.finishTimelineMotionPhase();
    }
    return moving > 0;
  }

  private timelineExitSide(node: ForceNode) {
    const motionGroupId = node.sceneNode.timelineBundleId ?? node.id;
    return stableUnit(`${motionGroupId}:timeline-exit-side`) < 0.5 ? -1 : 1;
  }

  private cancelTimelineTransition(snapToStable: boolean) {
    this.timelineIntentToken += 1;
    if (this.timelineRevisionWatchTimer !== null) {
      window.clearTimeout(this.timelineRevisionWatchTimer);
      this.timelineRevisionWatchTimer = null;
    }
    if (snapToStable) {
      this.nodes.forEach((node) => {
        const motion = node.timelineMotion;
        if (motion && !node.timelineRetiring) {
          this.freezeNode(node, motion.to);
          node.timelineOpacity = motion.opacityTo;
          node.timelineScale = motion.scaleTo;
          node.presentationScale = motion.presentationScaleTo;
          node.presentationCardScale = motion.presentationCardScaleTo;
          node.presentationOpacity = motion.presentationOpacityTo;
        }
        node.timelineMotion = undefined;
        node.renderedEntryOpacity = undefined;
        this.setObjectOpacity(
          node,
          node.visualOpacity ?? 1,
          node.visuallyEmphasized ?? false,
        );
      });
      this.pruneRetiringTimelineElements();
      this.syncGraphObjectPositions();
      this.updateLinkVisuals();
    }
    this.timelineIntentPending = false;
    this.timelineIntentDirection = null;
    this.timelineMotionPhase = "idle";
    this.controls.enableZoom = this.interactive;
    this.syncTimelineDiagnostics();
  }

  async moveTimeline(
    direction: UniverseTimelineDirection,
  ): Promise<UniverseTimelineIntentResult> {
    if (!this.interactive || this.paused || !this.timelineJourney.enabled) return "blocked";
    if (this.timelineIsBusy()) return "blocked";
    if (this.lockedId) {
      // Keep the locked network visually stable, but let the parent surface its
      // existing unlock guidance for wheel, keyboard and button attempts alike.
      try {
        await this.callbacks.onTimelineIntent(direction);
      } catch {
        // A locked attempt is presentation-only even if a parent notifier fails.
      }
      this.host.dataset.universeTimelineResult = "blocked";
      return "blocked";
    }
    if (direction === "next") {
      if (this.timelineJourney.phase === "complete") return "complete";
      if (!this.timelineJourney.hasNext) return "blocked";
    } else if (!this.timelineJourney.hasPrevious) return "blocked";

    const token = ++this.timelineIntentToken;
    const startWindowRevision = this.dataWindowRevision;
    this.timelineIntentPending = true;
    this.timelineIntentDirection = direction;
    this.timelineMotionPhase = "awaiting-result";
    this.controls.enableZoom = this.interactive;
    this.host.dataset.universeTimelineDirection = direction;
    this.host.dataset.universeTimelineResult = "";
    this.clearKeyboardFocus(true, false);
    if (this.hoveredId) this.handleNodeHover(null, false, true);
    this.syncTimelineDiagnostics();
    try {
      const result = await this.callbacks.onTimelineIntent(direction);
      if (token !== this.timelineIntentToken) return "blocked";
      const normalized: UniverseTimelineIntentResult = result === "advanced"
        || result === "complete"
        || result === "blocked"
        || result === "error"
        ? result
        : "error";
      this.host.dataset.universeTimelineResult = normalized;
      if (normalized === "advanced") {
        if (this.dataWindowRevision === startWindowRevision) {
          this.timelineMotionPhase = "awaiting-data";
          this.syncTimelineDiagnostics();
          this.timelineRevisionWatchTimer = window.setTimeout(() => {
            this.timelineRevisionWatchTimer = null;
            if (
              token !== this.timelineIntentToken
              || this.dataWindowRevision !== startWindowRevision
            ) return;
            this.cancelTimelineTransition(false);
          }, 1_600);
        }
        return normalized;
      }
      this.cancelTimelineTransition(false);
      return normalized;
    } catch {
      if (token === this.timelineIntentToken) {
        this.host.dataset.universeTimelineResult = "error";
        this.cancelTimelineTransition(false);
      }
      return "error";
    }
  }

  private createNodeObject(node: ForceNode) {
    if (node.object) return node.object;
    const group = new THREE.Group();
    group.userData.nodeId = node.id;
    let sprite: THREE.Sprite;
    if (node.kind === "event") {
      const haloMaterial = new THREE.SpriteMaterial({
        map: this.eventTexture,
        color: this.darkTheme ? EVENT_COLOR : EVENT_LIGHT_COLOR,
        transparent: true,
        opacity: node.sceneNode.root ? 0.58 : 0.44,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMaterial);
      const haloSize = node.sceneNode.root ? 14 : 11;
      halo.scale.set(haloSize, haloSize, haloSize);
      halo.renderOrder = 3;
      halo.userData.eventHalo = true;
      halo.userData.baseOpacity = haloMaterial.opacity;
      group.add(halo);

      const coreMaterial = new THREE.SpriteMaterial({
        map: this.eventCoreTexture,
        color: this.darkTheme ? EVENT_COLOR : EVENT_LIGHT_COLOR,
        transparent: true,
        opacity: node.sceneNode.root ? 1 : 0.94,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.NormalBlending,
      });
      sprite = new THREE.Sprite(coreMaterial);
      const coreSize = node.sceneNode.root ? 9.6 : 7.6;
      sprite.scale.set(coreSize, coreSize, coreSize);
      sprite.renderOrder = 4;
      sprite.userData.eventStar = true;
      sprite.userData.eventCore = true;
      sprite.userData.baseOpacity = coreMaterial.opacity;
      group.add(sprite);
      // The star stays visually small, while this transparent volume gives it
      // a stable pointer target across camera distance and device pixel ratio.
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
      const hit = new THREE.Mesh(this.sourceHitGeometry, hitMaterial);
      // Generous: exploring means landing the pointer on stars while they
      // drift with presence and parallax — a near miss must still count.
      const hitRadius = node.sceneNode.root ? 11 : 9.5;
      hit.scale.set(hitRadius, hitRadius, hitRadius);
      hit.userData.hitArea = true;
      hit.userData.eventHitArea = true;
      group.add(hit);
    } else if (node.kind === "entity") {
      const color = this.entityVisualColor(node.sourceId);
      const haloMaterial = new THREE.SpriteMaterial({
        map: this.entityTexture,
        color,
        transparent: true,
        opacity: node.sceneNode.root ? 0.34 : 0.26,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
      });
      const halo = new THREE.Sprite(haloMaterial);
      const haloSize = node.sceneNode.root ? 8 : 6.5;
      halo.scale.set(haloSize, haloSize, haloSize);
      halo.renderOrder = 2;
      halo.userData.entityHalo = true;
      halo.userData.baseOpacity = haloMaterial.opacity;
      group.add(halo);

      const coreMaterial = new THREE.SpriteMaterial({
        map: this.entityCoreTexture,
        color,
        transparent: true,
        opacity: node.sceneNode.root ? 0.96 : 0.84,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.NormalBlending,
      });
      sprite = new THREE.Sprite(coreMaterial);
      const coreSize = node.sceneNode.root ? 5.2 : 4;
      sprite.scale.set(coreSize, coreSize, coreSize);
      sprite.renderOrder = 2;
      sprite.userData.entityCore = true;
      sprite.userData.baseOpacity = coreMaterial.opacity;
      group.add(sprite);
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
      const hit = new THREE.Mesh(this.sourceHitGeometry, hitMaterial);
      const hitRadius = node.sceneNode.root ? 8 : 7;
      hit.scale.set(hitRadius, hitRadius, hitRadius);
      hit.userData.hitArea = true;
      hit.userData.entityHitArea = true;
      group.add(hit);
    } else {
      const color = this.sourceVisualColor(node.sourceId);
      const total = node.sceneNode.eventCount + node.sceneNode.entityCount;
      const size = THREE.MathUtils.clamp(11 + Math.log10(total + 1) * 4.1, 12, 22);
      const auraMaterial = new THREE.SpriteMaterial({
        map: this.sourceTexture,
        color,
        transparent: true,
        opacity: this.darkTheme ? 0.24 : 0.18,
        depthWrite: false,
        blending: this.darkTheme ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const aura = new THREE.Sprite(auraMaterial);
      aura.scale.set(size * 2.75, size * 2.75, size * 2.75);
      aura.userData.sourceAura = true;
      aura.userData.baseOpacity = auraMaterial.opacity;
      group.add(aura);
      const material = new THREE.SpriteMaterial({
        map: this.sourceTexture,
        color,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        blending: this.darkTheme ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      sprite = new THREE.Sprite(material);
      sprite.scale.set(size, size, size);
      sprite.userData.sourceCore = true;
      sprite.userData.baseOpacity = material.opacity;
      group.add(sprite);
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      });
      const hit = new THREE.Mesh(this.sourceHitGeometry, hitMaterial);
      const hitRadius = Math.max(24, node.sceneNode.radius * 0.9);
      hit.scale.set(hitRadius, hitRadius * 0.68, hitRadius * 0.86);
      hit.userData.hitArea = true;
      group.add(hit);
    }
    node.object = group;
    // three-force-graph creates custom objects after graphData() returns. Apply
    // the already-computed transition state immediately so a new star cannot
    // render for one frame at its material's full opacity and scale.
    node.renderedEntryOpacity = undefined;
    this.setObjectOpacity(
      node,
      node.visualOpacity ?? 1,
      node.visuallyEmphasized ?? false,
    );
    return group;
  }

  private pinNode(node: ForceNode) {
    this.cancelNodeEntry(node);
    this.freezeNode(node);
    node.visualOpacity = undefined;
    node.visuallyEmphasized = undefined;
    this.applyHighlight();
  }

  private releaseLockedNode(refresh = true) {
    const node = this.lockedId ? this.nodes.get(this.lockedId) : undefined;
    if (node) this.freezeNode(node);
    this.lockedId = null;
    this.host.dataset.universeLockedId = "";
    if (!refresh) return;
    if (this.dataReady) this.rebuildLabels();
    this.applyHighlight();
  }

  private rebuildAdjacency() {
    this.adjacency = new Map();
    this.links.forEach((link) => {
      const source = link.sourceId || endpointId(link.source);
      const target = link.targetId || endpointId(link.target);
      if (!this.adjacency.has(source)) this.adjacency.set(source, new Set());
      if (!this.adjacency.has(target)) this.adjacency.set(target, new Set());
      this.adjacency.get(source)?.add(target);
      this.adjacency.get(target)?.add(source);
    });
  }

  private labelFocusId() {
    const focusId = this.lockedId
      ?? this.selectedId
      ?? this.keyboardFocusedId
      ?? (this.visualDetailMix >= 0.5 ? this.hoveredId : null);
    return focusId && this.nodes.get(focusId)?.kind !== "source" ? focusId : null;
  }

  private transientHoverFocusId() {
    if (
      this.lockedId
      || this.selectedId
      || this.keyboardFocusedId
      || this.visualDetailMix < 0.5
    ) return null;
    const node = this.hoveredId ? this.nodes.get(this.hoveredId) : undefined;
    return node && node.kind !== "source" ? node.id : null;
  }

  private cancelHoverLabelRebuild() {
    if (this.hoverLabelTimer !== null) window.clearTimeout(this.hoverLabelTimer);
    if (this.hoverLabelFrame !== null) cancelAnimationFrame(this.hoverLabelFrame);
    this.hoverLabelTimer = null;
    this.hoverLabelFrame = null;
  }

  private cancelHoverClear() {
    if (this.hoverClearTimer !== null) window.clearTimeout(this.hoverClearTimer);
    this.hoverClearTimer = null;
  }

  private scheduleHoverLabelRebuild(immediate = false) {
    const focusId = this.labelFocusId();
    this.cancelHoverLabelRebuild();
    if (focusId === this.renderedLabelFocusId) return;
    const queueFrame = () => {
      this.hoverLabelTimer = null;
      this.hoverLabelFrame = requestAnimationFrame(() => {
        this.hoverLabelFrame = null;
        if (
          this.labelFocusId() !== focusId
          || this.renderedLabelFocusId === focusId
        ) return;
        this.rebuildLabels();
      });
    };
    if (immediate || focusId === null) queueFrame();
    else this.hoverLabelTimer = window.setTimeout(queueFrame, HOVER_LABEL_SETTLE_MS);
  }

  private handleNodeHover(
    node: ForceNode | null,
    fromLabel = false,
    immediateClear = false,
  ) {
    if (node && this.timelineIsBusy()) return;
    if (node && !this.pointerActive) return;
    if (node) this.cancelHoverClear();
    else if (!immediateClear && this.hoveredId) {
      if (this.hoverClearTimer === null) {
        this.hoverClearTimer = window.setTimeout(() => {
          this.hoverClearTimer = null;
          this.handleNodeHover(null, false, true);
        }, HOVER_CLEAR_GRACE_MS);
      }
      return;
    } else this.cancelHoverClear();
    if (
      node?.kind !== "source"
      && (this.visualDetailMix < 0.5 || node?.sourceId !== this.visualSourceId)
    ) {
      node = null;
    }
    if (node && this.keyboardFocusedId) this.clearKeyboardFocus(false, false);
    const nextId = node?.id ?? null;
    if (nextId === this.hoveredId) return;
    this.wakeRendering(700);
    this.hoveredId = nextId;
    this.hoveredFromLabel = Boolean(node && fromLabel);
    this.applyHighlight();
    this.scheduleHoverLabelRebuild();
    if (!node) {
      this.callbacks.onHover(null);
      return;
    }
    this.callbacks.onHover({
      node: node.sceneNode,
      x: this.pointerX,
      y: this.pointerY,
    });
  }

  private applyHighlight() {
    const anchorId = this.labelFocusId();
    const anchor = anchorId ? this.nodes.get(anchorId) : undefined;
    const neighbors = anchorId ? this.adjacency.get(anchorId) ?? new Set<string>() : null;
    const transientHoverId = this.transientHoverFocusId();
    const transientHover = anchorId !== null && anchorId === transientHoverId;
    const hitRank = new Map(this.sourceHits.map((hit, index) => [hit.source_id, index]));
    let relationCount = 0;
    this.links.forEach((link) => {
      const source = link.sourceId || endpointId(link.source);
      const target = link.targetId || endpointId(link.target);
      link.highlighted = Boolean(
        link.visible && anchorId && (source === anchorId || target === anchorId),
      );
      if (link.highlighted) relationCount += 1;
    });
    this.nodes.forEach((node) => {
      let opacity = 1;
      if (hitRank.size) {
        const rank = hitRank.get(node.sourceId);
        opacity = rank === 0 ? 1 : rank !== undefined ? 0.58 : 0.16;
      } else if (node.kind !== "source" && node.sceneNode.state !== "active") {
        // Dormant nodes recede without becoming undiscoverable. Every entity
        // keeps a visible glyph even when it does not receive a compact label.
        opacity = node.kind === "event" ? 0.52 : 0.48;
      }
      // Hover is a transient relationship preview: preserve the spatial and
      // brightness structure. Persistent selection may still mute unrelated
      // context to support deliberate inspection.
      if (anchorId && !transientHover) {
        if (node.id === anchorId) opacity = 1;
        else if (neighbors?.has(node.id)) opacity = 0.92;
        else if (node.kind === "source" && anchor?.sourceId === node.sourceId) {
          opacity = 0.38;
        } else opacity = 0.18;
      }
      const overviewSourceHovered = node.kind === "source"
        && this.visualDetailMix < 0.5
        && !this.lockedId
        && !this.selectedId
        && node.id === (this.keyboardFocusedId ?? this.hoveredId);
      this.setObjectOpacity(node, opacity, node.id === anchorId || overviewSourceHovered);
    });
    this.labels.forEach((label) => {
      if (label.kind !== "node") return;
      const labelNode = this.nodes.get(label.nodeId);
      label.element.dataset.expanded = String(
        labelNode?.kind === "event"
          && label.nodeId === anchorId
          && !transientHover,
      );
    });
    this.host.dataset.universeRenderedRelations = String(this.visibleEdgeIds.size);
    this.host.dataset.universeHighlightedRelations = String(relationCount);
    this.host.dataset.universeRelationAnchor = anchorId ?? "";
    this.updateNebulaAlphas();
    this.updateLinkVisuals();
    this.syncHighlightFlowSprites();
    this.sortLabelsForLayout();
    this.updateLabels(performance.now(), true);
    this.renderOnce();
  }

  private updateObjectOpacities() {
    this.applyHighlight();
  }

  private setObjectOpacity(node: ForceNode, opacity: number, emphasized: boolean) {
    const entryOpacity = (node.entryOpacity ?? 1) * (node.timelineOpacity ?? 1);
    const dataScale = currentNodePresentationScale(node);
    const dataOpacity = currentNodePresentationOpacity(node);
    const presenceScale = node.temporalPresenceScale ?? 1;
    const presenceOpacity = node.temporalPresenceOpacity ?? 1;
    const presenceKey = presenceScale * 4096 + presenceOpacity;
    if (
      node.visualOpacity === opacity
      && node.visuallyEmphasized === emphasized
      && node.renderedEntryOpacity === entryOpacity
      && node.renderedPresentationScale === dataScale
      && node.renderedPresentationOpacity === dataOpacity
      && node.renderedTemporalPresence === presenceKey
    ) return;
    node.visualOpacity = opacity;
    node.visuallyEmphasized = emphasized;
    node.renderedEntryOpacity = entryOpacity;
    node.renderedPresentationScale = dataScale;
    node.renderedPresentationOpacity = dataOpacity;
    node.renderedTemporalPresence = presenceKey;
    const object = node.object;
    if (!object) return;
    const entryScale = 0.28 + easeOutCubic(entryOpacity) * 0.72;
    // A transient hover is a glance, not a commitment: the network answers
    // with a whisper of scale. Only a locked focus earns the firm pop —
    // reading is the point, and jumping stars under the cursor break it.
    const emphasisScale = emphasized
      ? this.transientHoverFocusId() ? 1.04 : 1.12
      : 1;
    object.scale.setScalar(
      emphasisScale
        * entryScale
        * (node.timelineScale ?? 1)
        * this.nodeMorphScale(node)
        * dataScale
        * presenceScale,
    );
    object.traverse((child) => {
      if (child.userData.hitArea) {
        if (node.kind !== "source") {
          child.visible = entryOpacity * dataOpacity * presenceOpacity > 0.16;
        }
        return;
      }
      const candidate = child as THREE.Object3D & {
        material?: THREE.Material | THREE.Material[];
      };
      const materials = candidate.material
        ? Array.isArray(candidate.material) ? candidate.material : [candidate.material]
        : [];
      materials.forEach((material) => {
        material.transparent = true;
        const configuredBase = typeof child.userData.baseOpacity === "number"
          ? child.userData.baseOpacity
          : null;
        const base = configuredBase ?? (node.kind === "source"
          ? 0.96
          : node.kind === "event"
            ? node.sceneNode.root ? 1 : 0.9
            : node.sceneNode.root ? 0.9 : 0.7);
        const detailFactor = this.sourceMarkerDetailFactor(node, child);
        material.opacity = entryOpacity <= 0.001
          ? 0
          : Math.max(
              child.userData.sourceAura
                ? 0
                : 0.035 * entryOpacity * dataOpacity * presenceOpacity,
              base * opacity * entryOpacity * detailFactor
                * dataOpacity * presenceOpacity,
            );
      });
    });
  }

  private nodeProjectionScale(node: ForceNode) {
    if (node.kind === "source") return 1;
    const camera = this.graph.camera() as THREE.PerspectiveCamera;
    if (!camera.isPerspectiveCamera || !Number.isFinite(camera.fov)) return 1;
    const distance = Math.hypot(
      camera.position.x - node.x,
      camera.position.y - node.y,
      camera.position.z - node.z,
    );
    const visibleWorldHeight = 2 * distance
      * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const coreSize = node.kind === "event"
      ? node.sceneNode.root ? 9.6 : 7.6
      : node.sceneNode.root ? 5.2 : 4;
    const projectedPixels = coreSize * Math.max(1, this.host.clientHeight)
      / Math.max(1, visibleWorldHeight);
    const minimumPixels = node.kind === "event"
      ? node.sceneNode.root ? 18 : 15
      : node.sceneNode.root ? 10 : 8;
    const maximumPixels = node.kind === "event"
      ? node.sceneNode.root ? 30 : 24
      : node.sceneNode.root ? 16 : 14;
    const maximumScale = node.kind === "event" ? 2.4 : 3.2;
    const requestedScale = projectedPixels < minimumPixels
      ? minimumPixels / Math.max(1, projectedPixels)
      : projectedPixels > maximumPixels
        ? maximumPixels / projectedPixels
        : 1;
    return THREE.MathUtils.clamp(
      requestedScale,
      0.12,
      maximumScale,
    );
  }

  private nodeMorphScale(node: ForceNode) {
    if (node.kind === "source") return 1;
    const progress = node.sourceId === this.visualSourceId ? this.visualDetailMix : 0;
    return (0.82 + easeOutCubic(progress) * 0.18) * this.nodeProjectionScale(node);
  }

  private sourceMarkerDetailFactor(node: ForceNode, child: THREE.Object3D) {
    if (child.userData.sourceAura) {
      return Math.max(0, 1 - this.visualDetailMix * 1.15);
    }
    if (child.userData.sourceCore && node.sourceId === this.visualSourceId) {
      const detail = THREE.MathUtils.smoothstep(this.visualDetailMix, 0.28, 0.72);
      return Math.max(0, 1 - detail);
    }
    return 1;
  }

  // Projection scale tracks camera distance, so a dolly dirties every node, and
  // OrbitControls emits change synchronously without rAF coalescing. Throttling to
  // the visual-refresh cadence is safe for animating nodes: setObjectOpacity
  // applies the same formula every frame while a timelineMotion is in flight.
  private updateNodeMorphScales(now = performance.now(), force = false) {
    const elapsed = this.lastNodeMorphAt > 0
      ? Math.max(1, now - this.lastNodeMorphAt)
      : 32;
    if (!force && elapsed < 24) return;
    this.lastNodeMorphAt = now;
    this.nodes.forEach((node) => {
      if (!node.object) return;
      const entryOpacity = (node.entryOpacity ?? 1) * (node.timelineOpacity ?? 1);
      const entryScale = 0.28 + easeOutCubic(entryOpacity) * 0.72;
      const dataScale = currentNodePresentationScale(node);
      const emphasisScale = node.visuallyEmphasized
        ? this.transientHoverFocusId() ? 1.04 : 1.12
        : 1;
      node.object.scale.setScalar(
        emphasisScale
          * entryScale
          * (node.timelineScale ?? 1)
          * this.nodeMorphScale(node)
          * dataScale
          * (node.temporalPresenceScale ?? 1),
      );
      node.renderedPresentationScale = dataScale;
    });
  }

  private updateSourceAuraOpacities() {
    this.nodes.forEach((node) => {
      if (node.kind !== "source") return;
      node.object?.traverse((child) => {
        if (!child.userData.sourceAura && !child.userData.sourceCore) return;
        const material = (child as THREE.Sprite).material as THREE.SpriteMaterial;
        const base = typeof child.userData.baseOpacity === "number"
          ? child.userData.baseOpacity
          : child.userData.sourceAura
            ? this.darkTheme ? 0.24 : 0.18
            : 0.96;
        const opacity = node.visualOpacity ?? 1;
        const dataOpacity = currentNodePresentationOpacity(node);
        const detailFactor = this.sourceMarkerDetailFactor(node, child);
        material.opacity = base * opacity * detailFactor * dataOpacity;
        child.visible = material.opacity > 0.008;
      });
    });
  }

  private updateNodeTheme() {
    this.nodes.forEach((node) => {
      node.object?.traverse((child) => {
        if (child.userData.hitArea) return;
        const material = (child as THREE.Object3D & { material?: THREE.Material }).material;
        if (!material) return;
        if ((material as THREE.SpriteMaterial).isSpriteMaterial) {
          (material as THREE.SpriteMaterial).color.copy(
            node.kind === "event"
              ? this.darkTheme ? EVENT_COLOR : EVENT_LIGHT_COLOR
              : node.kind === "entity"
                ? this.entityVisualColor(node.sourceId)
                : this.sourceVisualColor(node.sourceId),
          );
        }
        if (child.userData.sourceAura) {
          child.userData.baseOpacity = this.darkTheme ? 0.24 : 0.18;
        }
        if (child.userData.eventHalo || child.userData.entityHalo) {
          material.blending = THREE.AdditiveBlending;
        } else if (child.userData.eventCore || child.userData.entityCore) {
          material.blending = THREE.NormalBlending;
        } else {
          material.blending = this.darkTheme
            ? THREE.AdditiveBlending
            : THREE.NormalBlending;
        }
        material.needsUpdate = true;
      });
      node.visualOpacity = undefined;
      node.visuallyEmphasized = undefined;
      node.renderedEntryOpacity = undefined;
    });
  }

  private rebuildNebula() {
    const sources = [...this.nodes.values()].filter((node) => node.kind === "source");
    const mobile = this.host.clientWidth < 768;
    const configuredBudget = mobile
      ? this.policy.proxy_budget_mobile
      : this.policy.proxy_budget_desktop;
    const budgetCap = mobile ? 2_000 : 6_000;
    const budget = Math.min(
      budgetCap,
      Math.max(0, Number.isFinite(configuredBudget) ? configuredBudget : 0),
    );
    this.host.dataset.universeNebulaConfiguredBudget = String(configuredBudget);
    this.host.dataset.universeNebulaBudgetCap = String(budgetCap);
    this.host.dataset.universeNebulaBudget = String(budget);
    // The browsed source owns the sky while inside it: it takes a heavier
    // share of the particle budget, rebuilt once per session entry/exit.
    const browsedSourceId = this.flightConfig?.sourceId ?? null;
    const signature = `${mobile ? "mobile" : "desktop"}:${budget}:${browsedSourceId ?? "none"}:` + sources
      .map((node) => `${node.id}:${Math.round(node.sceneNode.radius)}:${node.sceneNode.eventCount}:${node.sceneNode.entityCount}`)
      .join("|");
    if (signature === this.sourceSignature && this.nebulaPoints) {
      this.updateNebulaPositions();
      this.updateNebulaAlphas();
      return;
    }
    this.sourceSignature = signature;
    this.clearNebula();
    if (!sources.length) return;
    this.nebulaSourceIndices = new Map(
      sources.map((source, index) => [source.sourceId, index]),
    );
    const weights = sources.map((source) =>
      Math.max(1, Math.log2(source.sceneNode.eventCount + source.sceneNode.entityCount + 2))
        * (source.sourceId === browsedSourceId ? 6 : 1),
    );
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const baseCount = Math.max(
      0,
      Math.min(mobile ? 10 : 14, Math.floor(budget / Math.max(1, sources.length))),
    );
    const weightedBudget = Math.max(0, budget - baseCount * sources.length);
    const particles: NebulaParticle[] = [];
    sources.forEach((source, sourceIndex) => {
      const count = baseCount + Math.floor(
        (weightedBudget * weights[sourceIndex]) / Math.max(1, totalWeight),
      );
      const radius = Math.max(40, source.sceneNode.radius * 1.45);
      const rotation = new THREE.Euler(
        (stableUnit(`${source.id}:rx`) - 0.5) * 0.7,
        (stableUnit(`${source.id}:ry`) - 0.5) * 0.9,
        stableUnit(`${source.id}:rz`) * Math.PI,
      );
      const armCount = 3 + Math.floor(stableUnit(`${source.id}:arm-count`) * 2);
      const winding = Math.PI * (
        2.7 + stableUnit(`${source.id}:arm-winding`) * 0.8
      );
      const ellipticity = 0.72 + stableUnit(`${source.id}:ellipticity`) * 0.12;
      for (let index = 0; index < count; index += 1) {
        const key = `${source.id}:dust:${index}`;
        // Hero anatomy: half the grains pile into a blazing tight heart, the
        // disc stays thin, and a wide sprinkle dusts the whole frame.
        const population = stableUnit(`${key}:population`);
        const coreParticle = population < 0.5;
        const haloParticle = population >= 0.88;
        const radial = haloParticle
          ? 1.35 + stableUnit(`${key}:halo`) * 1.65
          : Math.pow(
              stableUnit(`${key}:radius`),
              coreParticle ? 2.55 : 0.7,
            );
        const armIndex = Math.min(
          armCount - 1,
          Math.floor(stableUnit(`${key}:arm-index`) * armCount),
        );
        const armAngle = (armIndex / armCount) * Math.PI * 2 + radial * winding;
        // Tight arm lanes are the silhouette: the brand galaxy reads as a
        // galaxy because its arms have edges, not a uniform disc of scatter.
        const armSpread = (stableUnit(`${key}:arm-spread`) - 0.5)
          * (coreParticle ? 1.3 : 0.5)
          * (1.08 - radial * 0.42);
        const angle = armAngle + armSpread;
        const planarRadius = radius * radial;
        const offset = new THREE.Vector3(
          Math.cos(angle) * planarRadius * (
            1.08 + stableUnit(`${key}:stretch`) * 0.12
          ),
          Math.sin(angle) * planarRadius * ellipticity,
          (stableUnit(`${key}:depth`) - 0.5)
            * radius
            * (coreParticle ? 0.34 : 0.14)
            * (1.16 - radial * 0.36),
        );
        offset.applyEuler(rotation);
        const twinkle = Math.pow(stableUnit(`${key}:twinkle`), 1.18);
        const glowSeed = stableUnit(`${key}:glow`);
        // Sparse: light pockets punctuate the grain field, never blanket it.
        const glowChance = coreParticle ? 0.05 : 0.02;
        particles.push({
          sourceId: source.sourceId,
          sourceIndex,
          offset,
          core: coreParticle,
          radial: Math.min(1, radial),
          alpha: haloParticle
            ? 0.06 + stableUnit(`${key}:alpha`) * 0.16
            : (coreParticle ? 0.5 : 0.26)
              + stableUnit(`${key}:alpha`) * (coreParticle ? 0.5 : 0.56),
          glow: glowSeed < glowChance
            ? 0.58 + stableUnit(`${key}:glow-strength`) * 0.42
            : 0,
          phase: stableUnit(`${key}:phase`) * Math.PI * 2,
          twinkle,
        });
      }
    });
    this.host.dataset.universeParticleCount = String(particles.length);
    this.nebulaParticles = particles;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particles.length * 3);
    const corridors = new Float32Array(particles.length * 3);
    const corridorWalls = new Float32Array(particles.length);
    const colors = new Float32Array(particles.length * 3);
    const sizes = new Float32Array(particles.length);
    const alphas = new Float32Array(particles.length);
    const glows = new Float32Array(particles.length);
    const sourceIndices = new Float32Array(particles.length);
    const shapes = new Float32Array(particles.length);
    const phases = new Float32Array(particles.length);
    const twinkles = new Float32Array(particles.length);
    const axisDepthBySource = new Map(sources.map((source) => [
      source.sourceId,
      Math.max(0, source.sceneNode.eventCount - 1)
        * UNIVERSE_TEMPORAL_AXIS_UNITS_PER_EVENT,
    ]));
    const lateralBySource = new Map(sources.map((source) => [
      source.sourceId,
      Math.max(72, source.sceneNode.radius) * 1.8,
    ]));
    particles.forEach((particle, index) => {
      // Keep the source's entry colour all the way through the nebula. A
      // restrained white lift gives the core its readable glow without
      // washing blue, violet, green, or copper sources into one gold cloud.
      const color = this.sourceVisualColor(particle.sourceId);
      const whiteMix = particle.core
        ? 0.2 + (1 - particle.radial) * 0.28
        : stableUnit(`${particle.sourceId}:${index}:white`)
          * (this.darkTheme ? 0.16 : 0.1);
      color.lerp(WHITE, whiteMix);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      // Brand grain: fine dust, a denser bright heart carried by size too.
      sizes[index] = 0.95
        + stableUnit(`${particle.sourceId}:${index}:size`) * 2.2
        + (particle.twinkle > 0.86 ? 0.45 : 0)
        + (particle.core ? (1 - particle.radial) * 0.8 : 0);
      alphas[index] = particle.alpha;
      glows[index] = particle.glow;
      sourceIndices[index] = particle.sourceIndex;
      shapes[index] = particle.glow === 0 && particle.twinkle > 0.84 ? 1 : 0;
      phases[index] = particle.phase;
      twinkles[index] = 0.18 + particle.twinkle * 0.82;
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
      const wall = particle.glow === 0
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
      corridorWalls[index] = wall ? 1 : 0;
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
    geometry.setAttribute("aCorridorWall", new THREE.BufferAttribute(corridorWalls, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", alphaAttribute);
    geometry.setAttribute("aGlow", new THREE.BufferAttribute(glows, 1));
    geometry.setAttribute("aSourceIndex", new THREE.BufferAttribute(sourceIndices, 1));
    geometry.setAttribute("aShape", new THREE.BufferAttribute(shapes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
    this.nebulaPoints = new THREE.Points(geometry, makeNebulaMaterial(this.darkTheme));
    this.nebulaPoints.name = "sag-source-nebulae";
    this.nebulaPoints.frustumCulled = false;
    this.graph.scene().add(this.nebulaPoints);
    this.updatePixelRatio();
    this.updateNebulaPositions();
    this.updateNebulaAlphas(true);
    this.syncNebulaCorridorUniforms();
    this.updateNebulaMotionState();
    this.armNebulaAnimation();
  }

  /**
   * Clamps rotation to a forward gaze cone while browsing: a bounded glance
   * around the corridor, never an orbit that flips the nebula over. The axis
   * is world-aligned, so azimuth 0 already faces down the corridor.
   */
  private applyBrowseGaze() {
    this.controls.minAzimuthAngle = -BROWSE_GAZE_AZIMUTH_RAD;
    this.controls.maxAzimuthAngle = BROWSE_GAZE_AZIMUTH_RAD;
    this.controls.minPolarAngle = Math.PI / 2 - BROWSE_GAZE_POLAR_RAD;
    this.controls.maxPolarAngle = Math.PI / 2 + BROWSE_GAZE_POLAR_RAD;
    this.controls.rotateSpeed = BROWSE_GAZE_ROTATE_SPEED;
    this.controls.panSpeed = BROWSE_GAZE_PAN_SPEED;
    this.browseGazeApplied = true;
    this.host.dataset.universeBrowseGaze = "locked";
  }

  private releaseBrowseGaze() {
    if (this.browseGazeTimer !== null) {
      window.clearTimeout(this.browseGazeTimer);
      this.browseGazeTimer = null;
    }
    if (!this.browseGazeApplied) return;
    this.controls.minAzimuthAngle = Number.NEGATIVE_INFINITY;
    this.controls.maxAzimuthAngle = Number.POSITIVE_INFINITY;
    this.controls.minPolarAngle = 0;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.rotateSpeed = UNIVERSE_ROTATE_SPEED;
    this.controls.panSpeed = UNIVERSE_PAN_SPEED;
    this.browseGazeApplied = false;
    this.host.dataset.universeBrowseGaze = "free";
  }

  /**
   * Points the corridor's loaded-window band at the browsed source's visible
   * depth range so dust yields exactly where real packages condensed.
   */
  private syncNebulaCorridorUniforms() {
    const material = this.nebulaPoints?.material as THREE.ShaderMaterial | undefined;
    if (!material) return;
    const config = this.flightConfig;
    material.uniforms.uCorridorNearZ.value = config
      ? config.centerZ - config.windowNearDepth
      : NEBULA_CORRIDOR_BAND_OFF;
    material.uniforms.uCorridorFarZ.value = config
      ? config.centerZ - config.windowFarDepth
      : NEBULA_CORRIDOR_BAND_OFF;
    // The dust wrap re-anchors to wherever the camera is on the axis, so it
    // must ride the flight depth every frame it changes.
    material.uniforms.uFlightDepth.value = config ? this.appliedFlightDepth : 0;
    material.uniforms.uCorridorAxisDepth.value = config
      ? Math.max(0, config.maxDepth)
      : 0;
    material.uniforms.uCorridorCenterZ.value = config ? config.centerZ : 0;
    material.uniforms.uCorridorVestibule.value = config
      ? Math.max(0, config.vestibuleDepth)
      : 0;
  }

  private updateNebulaPositions() {
    if (!this.nebulaPoints) return;
    const position = this.nebulaPoints.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sources = new Map(
      [...this.nodes.values()]
        .filter((node) => node.kind === "source")
        .map((node) => [node.sourceId, node]),
    );
    this.nebulaParticles.forEach((particle, index) => {
      const source = sources.get(particle.sourceId);
      if (!source) return;
      position.setXYZ(
        index,
        source.x + particle.offset.x,
        source.y + particle.offset.y,
        source.z + particle.offset.z,
      );
    });
    position.needsUpdate = true;
  }

  private updateNebulaAlphas(force = false) {
    if (!this.nebulaPoints) return;
    const material = this.nebulaPoints.material as THREE.ShaderMaterial;
    material.uniforms.uDetail.value = this.visualDetailMix;
    material.uniforms.uDetailSource.value = this.visualSourceId
      ? this.nebulaSourceIndices.get(this.visualSourceId) ?? -1
      : -1;
    const detailFactor = THREE.MathUtils.lerp(
      1,
      NEBULA_DETAIL_ALPHA,
      THREE.MathUtils.smoothstep(this.visualDetailMix, 0.18, 0.78),
    );
    this.host.dataset.universeNebulaDetailFactor = detailFactor.toFixed(2);
    this.host.dataset.universeNebulaAlphaMode = "gpu-detail";
    const persistentAnchor = this.nodes.get(
      this.lockedId ?? this.selectedId ?? this.keyboardFocusedId ?? "",
    );
    const hovered = this.hoveredId ? this.nodes.get(this.hoveredId) : undefined;
    // Hovering a concrete node must not make unrelated stars/nebulae vanish.
    // Source hover remains an overview affordance; selection remains deliberate.
    const anchor = persistentAnchor ?? (hovered?.kind === "source" ? hovered : undefined);
    const contextKey = anchor
      ? `anchor:${anchor.kind}:${anchor.sourceId}`
      : this.sourceHits.length
        ? `hits:${this.sourceHits.map((hit) => hit.source_id).join("|")}`
        : "default";
    const modeKey = contextKey;
    if (!force && modeKey === this.nebulaAlphaKey) return;
    this.nebulaAlphaKey = modeKey;
    const alpha = this.nebulaPoints.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const hitRank = new Map(this.sourceHits.map((hit, index) => [hit.source_id, index]));
    // Context changes are rare CPU buffer updates. The source-detail morph is
    // handled continuously by shader uniforms above, avoiding repeated uploads
    // of the full alpha attribute while the camera moves into a nebula.
    this.nebulaParticles.forEach((particle, index) => {
      let multiplier = 1;
      if (anchor?.kind === "source") {
        multiplier = anchor.sourceId === particle.sourceId ? 1.28 : 0.14;
      } else if (anchor) {
        multiplier = anchor.sourceId === particle.sourceId ? 0.48 : 0.1;
      }
      else if (hitRank.size) {
        const rank = hitRank.get(particle.sourceId);
        multiplier = rank === 0 ? 1 : rank !== undefined ? 0.52 : 0.12;
      }
      alpha.setX(index, particle.alpha * multiplier);
    });
    alpha.needsUpdate = true;
    this.nebulaAlphaUploads += 1;
    this.host.dataset.universeNebulaAlphaUploads = String(this.nebulaAlphaUploads);
  }

  private nebulaMotionStrength() {
    if (
      !this.nebulaPoints
      || !this.interactive
      || this.reducedMotion
      || this.reportedViewSourceId
      || performance.now() < this.cameraCalmUntil
      || document.visibilityState !== "visible"
    ) return 0;
    return THREE.MathUtils.clamp((0.52 - this.visualDetailMix) / 0.22, 0, 1);
  }

  private shouldAnimateNebula(now = performance.now()) {
    return this.nebulaMotionStrength() > 0.01 && now < this.nebulaAnimationUntil;
  }

  private armNebulaAnimation(duration = NEBULA_BURST_MS) {
    if (this.paused || this.nebulaMotionStrength() <= 0.01) return;
    const now = performance.now();
    this.nebulaAnimationUntil = Math.max(this.nebulaAnimationUntil, now + duration);
    this.updateNebulaMotionState();
    this.wakeRendering(duration + 120);
    this.startLoop(duration + 120);
  }

  private updateNebulaMotionState() {
    const strength = this.nebulaMotionStrength();
    const active = this.shouldAnimateNebula();
    this.host.dataset.universeNebulaMotion = active ? "active" : "idle";
    if (!this.nebulaPoints) return;
    const material = this.nebulaPoints.material as THREE.ShaderMaterial;
    material.uniforms.uMotion.value = strength;
  }

  private updateNebulaAnimation(now: number) {
    const strength = this.nebulaMotionStrength();
    const active = this.shouldAnimateNebula(now);
    if (!this.nebulaPoints) return false;
    const material = this.nebulaPoints.material as THREE.ShaderMaterial;
    material.uniforms.uMotion.value = strength;
    if (!active) {
      this.host.dataset.universeNebulaMotion = "idle";
      return false;
    }
    this.host.dataset.universeNebulaMotion = "active";
    const frameInterval = this.host.clientWidth < 768 ? 50 : 1000 / 30;
    if (now - this.lastNebulaAnimationAt >= frameInterval) {
      this.lastNebulaAnimationAt = now;
      material.uniforms.uTime.value = now / 1000;
      if (!this.renderingAwake) {
        this.graph.renderer().render(this.graph.scene(), this.graph.camera());
      }
    }
    return true;
  }

  private clearNebula() {
    this.nebulaParticles = [];
    this.nebulaSourceIndices.clear();
    this.nebulaAlphaKey = "";
    this.nebulaAlphaUploads = 0;
    this.lastNebulaAnimationAt = 0;
    this.nebulaAnimationUntil = 0;
    this.host.dataset.universeNebulaMotion = "idle";
    this.host.dataset.universeNebulaAlphaUploads = "0";
    this.host.dataset.universeParticleCount = "0";
    if (!this.nebulaPoints) {
      return;
    }
    this.graph.scene().remove(this.nebulaPoints);
    this.nebulaPoints.geometry.dispose();
    const material = this.nebulaPoints.material;
    (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
    this.nebulaPoints = null;
  }

  private sourceVisualColor(sourceId: string) {
    return themedSourceColor(sourceId, this.darkTheme);
  }

  private entityVisualColor(sourceId: string) {
    // Entity sprites share the source hue; a tiny white lift keeps the small
    // core legible without reintroducing a second, unrelated entity palette.
    return this.sourceVisualColor(sourceId).lerp(
      WHITE,
      this.darkTheme ? 0.12 : 0.08,
    );
  }

  private restingLinkOpacity() {
    const load = THREE.MathUtils.clamp((this.visibleEdgeIds.size - 24) / 336, 0, 1);
    return this.darkTheme
      ? THREE.MathUtils.lerp(0.18, 0.055, load)
      : THREE.MathUtils.lerp(0.16, 0.045, load);
  }

  private linkWorldWidth() {
    // three-forcegraph rounds cylinder widths upward to one decimal place.
    // Use values that survive that quantization instead of 0.22 becoming 0.3.
    return this.links.length >= 240 ? 0.1 : 0.2;
  }

  private linkVisualStyle(link: ForceLink) {
    const source = this.nodes.get(link.sourceId);
    const target = this.nodes.get(link.targetId);
    const dataOpacity = presentationOpacity(link.sceneLink.presentationOpacity);
    // A link is only as present as its dimmer endpoint on the flight axis.
    const presenceOpacity = Math.min(
      source?.temporalPresenceOpacity ?? 1,
      target?.temporalPresenceOpacity ?? 1,
    );
    const timelineOpacity = Math.min(
      (source?.entryOpacity ?? 1) * (source?.timelineOpacity ?? 1),
      (target?.entryOpacity ?? 1) * (target?.timelineOpacity ?? 1),
    ) * dataOpacity * presenceOpacity;
    if (!link.visible) {
      return { color: this.darkTheme ? "#5b747a" : "#70898e", opacity: 0 };
    }
    if (link.highlighted) {
      return {
        color: this.darkTheme ? "#b5f2fb" : "#0b6677",
        opacity: (this.darkTheme ? 0.96 : 0.9) * timelineOpacity,
      };
    }
    if (this.transientHoverFocusId()) {
      return {
        color: this.darkTheme ? "#527d85" : "#526f75",
        opacity: this.restingLinkOpacity() * 0.68 * timelineOpacity,
      };
    }
    if (this.labelFocusId()) {
      return {
        color: this.darkTheme ? "#49666b" : "#71868a",
        opacity: (this.darkTheme ? 0.035 : 0.025) * timelineOpacity,
      };
    }
    return {
      color: this.darkTheme ? "#5b949e" : "#385f66",
      opacity: this.restingLinkOpacity() * timelineOpacity,
    };
  }

  private ensureLinkMaterial(link: ForceLink) {
    if (!link.lineMaterial) {
      link.lineMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.NormalBlending,
      });
    }
    const style = this.linkVisualStyle(link);
    link.lineMaterial.color.set(style.color);
    link.lineMaterial.opacity = style.opacity;
    return link.lineMaterial;
  }

  private updateLinkVisuals() {
    this.links.forEach((link) => {
      const material = this.ensureLinkMaterial(link);
      const style = this.linkVisualStyle(link);
      material.color.set(style.color);
      material.opacity = style.opacity;
      material.depthTest = !link.highlighted;
      if (link.__lineObj) {
        link.__lineObj.visible = link.visible;
        link.__lineObj.renderOrder = link.highlighted ? 1 : 0;
      }
    });
  }

  private clearHighlightFlowSprites() {
    this.stopHighlightFlowAnimation();
    this.highlightFlowSprites.forEach((sprite) => sprite.removeFromParent());
    this.highlightFlowSprites.clear();
    this.lastHighlightFlowAt = 0;
    this.host.dataset.universeHighlightFlowCount = "0";
    this.host.dataset.universeHighlightFlowMotion = "idle";
  }

  private syncHighlightFlowSprites() {
    const highlighted = this.reducedMotion
      ? []
      : this.links.filter((link) => link.visible && link.highlighted);
    const highlightedIds = new Set(highlighted.map((link) => link.id));
    this.highlightFlowSprites.forEach((sprite, id) => {
      if (highlightedIds.has(id)) return;
      sprite.removeFromParent();
      this.highlightFlowSprites.delete(id);
    });
    this.highlightFlowMaterial.color.set(this.darkTheme ? "#d7fbff" : "#0b6677");
    highlighted.forEach((link) => {
      const existing = this.highlightFlowSprites.get(link.id);
      if (existing) {
        existing.userData.link = link;
        return;
      }
      const sprite = new THREE.Sprite(this.highlightFlowMaterial);
      sprite.name = `sag-highlight-flow:${link.id}`;
      sprite.frustumCulled = false;
      sprite.renderOrder = 4;
      sprite.scale.set(2.6, 2.6, 1);
      sprite.userData.link = link;
      sprite.userData.flowPhase = stableUnit(`${link.id}:flow-phase`);
      this.highlightFlowSprites.set(link.id, sprite);
      this.graph.scene().add(sprite);
    });
    this.host.dataset.universeHighlightFlowCount = String(
      this.highlightFlowSprites.size,
    );
    const animate = !this.reducedMotion
      && this.highlightFlowSprites.size > 0
      && Boolean(this.transientHoverFocusId());
    this.updateHighlightFlowSprites(performance.now(), animate);
    if (animate) this.scheduleHighlightFlowAnimation();
    else {
      this.stopHighlightFlowAnimation();
      this.host.dataset.universeHighlightFlowMotion = this.highlightFlowSprites.size > 0
        ? "static"
        : "idle";
    }
  }

  /**
   * Relationship glints are presentation-only. Keep them off the scene's main
   * animation loop so a pinned network cannot force label collision, LOD and
   * layout work to run forever. A transient pointer hover gets its own capped
   * timer; a click/keyboard lock keeps the glints at deterministic positions.
   */
  private updateHighlightFlowSprites(now: number, animate: boolean) {
    if (this.highlightFlowSprites.size === 0) return;
    this.lastHighlightFlowAt = now;
    this.highlightFlowSprites.forEach((sprite) => {
      const link = sprite.userData.link as ForceLink | undefined;
      const source = link ? this.nodes.get(link.sourceId) : undefined;
      const target = link ? this.nodes.get(link.targetId) : undefined;
      if (!link?.highlighted || !source || !target) {
        sprite.visible = false;
        return;
      }
      const flowPhase = sprite.userData.flowPhase as number;
      const progress = animate && !this.reducedMotion
        ? (now * 0.00042 + flowPhase) % 1
        : 0.34 + flowPhase * 0.32;
      sprite.visible = true;
      sprite.position.set(
        THREE.MathUtils.lerp(source.x, target.x, progress),
        THREE.MathUtils.lerp(source.y, target.y, progress),
        THREE.MathUtils.lerp(source.z, target.z, progress),
      );
      const pulse = 0.88 + Math.sin(progress * Math.PI) * 0.34;
      sprite.scale.set(2.6 * pulse, 2.6 * pulse, 1);
    });
  }

  private stopHighlightFlowAnimation() {
    if (this.highlightFlowTimer !== null) {
      window.clearTimeout(this.highlightFlowTimer);
      this.highlightFlowTimer = null;
    }
  }

  private scheduleHighlightFlowAnimation() {
    if (
      this.paused
      || this.reducedMotion
      || document.visibilityState !== "visible"
      || !this.transientHoverFocusId()
      || this.highlightFlowSprites.size === 0
    ) {
      this.stopHighlightFlowAnimation();
      return;
    }
    this.host.dataset.universeHighlightFlowMotion = "animated";
    if (this.highlightFlowTimer !== null) return;
    const elapsed = performance.now() - this.lastHighlightFlowAt;
    this.highlightFlowTimer = window.setTimeout(() => {
      this.highlightFlowTimer = null;
      if (
        this.paused
        || this.reducedMotion
        || document.visibilityState !== "visible"
        || !this.transientHoverFocusId()
        || this.highlightFlowSprites.size === 0
      ) return;
      this.updateHighlightFlowSprites(performance.now(), true);
      if (!this.renderingAwake) this.renderOnce();
      this.scheduleHighlightFlowAnimation();
    }, Math.max(0, HIGHLIGHT_FLOW_FRAME_MS - elapsed));
  }

  private renderOnce() {
    if (this.paused || document.visibilityState !== "visible") return;
    this.graph.renderer().render(this.graph.scene(), this.graph.camera());
  }

  private rebuildLabels() {
    const focusId = this.labelFocusId();
    const transientHover = focusId !== null && focusId === this.transientHoverFocusId();
    this.cancelHoverLabelRebuild();
    const retainedLabelRank = new Map(
      this.labels
        .filter((label) => label.kind === "node")
        .map((label, index) => [label.nodeId, index]),
    );
    this.rebuildingLabels = true;
    const existingLabels = new Map(
      this.labels.map((label) => [`${label.kind}:${label.nodeId}`, label]),
    );
    const nextLabels: SceneLabel[] = [];
    let reusedLabelCount = 0;
    const mobile = this.host.clientWidth < 768;
    const sourceRank = new Map(this.sourceHits.map((hit, index) => [hit.source_id, index]));
    const focusNeighbors = focusId ? this.adjacency.get(focusId) ?? new Set<string>() : null;
    const labelSourceId = focusId
      ? this.nodes.get(focusId)?.sourceId ?? this.visualSourceId
      : this.visualSourceId;
    this.renderedLabelFocusId = focusId;
    this.host.dataset.universeLabelFocus = focusId ?? "";
    this.host.dataset.universeLabelNeighborCount = String(focusNeighbors?.size ?? 0);
    const sources = [...this.nodes.values()]
      .filter((node) => node.kind === "source")
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
      [...this.nodes.values()]
        .filter((node): node is ForceNode & { kind: "event" | "entity" } =>
          node.kind === "event" || node.kind === "entity"),
      focusId,
      focusNeighbors ?? [],
      labelSourceId,
    );
    const focusCardIds = new Set(focusCardPlan.ids);
    const hasConcreteFocus = focusCardIds.size > 0;
    this.host.dataset.universeFocusCardCount = String(focusCardPlan.ids.length);
    this.host.dataset.universeFocusEventCardCount = String(focusCardPlan.eventCount);
    this.host.dataset.universeFocusEntityCardCount = String(focusCardPlan.entityCount);
    // Card preferences control the resting scene. Hover, keyboard focus and
    // click lock all reveal the complete factual one-hop group.
    const showEventCards = this.viewPreferences.showEventCards || hasConcreteFocus;
    const showEntityCards = this.viewPreferences.showEntityCards || hasConcreteFocus;
    const cardBudget = universeCardBudget(
      Math.max(1, this.host.clientWidth),
      Math.max(1, this.host.clientHeight),
      showEventCards,
      showEntityCards,
    );
    const prioritize = (left: ForceNode, right: ForceNode) => {
      const emphasisRank = (node: ForceNode) => {
        if (node.id === this.lockedId) return 0;
        if (node.id === this.selectedId) return 1;
        if (node.id === this.keyboardFocusedId) return 2;
        if (node.id === this.hoveredId) return 3;
        return 4;
      };
      const emphasisDifference = emphasisRank(left) - emphasisRank(right);
      if (emphasisDifference) return emphasisDifference;
      const leftConnected = Boolean(focusNeighbors?.has(left.id));
      const rightConnected = Boolean(focusNeighbors?.has(right.id));
      if (leftConnected !== rightConnected) return leftConnected ? -1 : 1;
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
    const candidates = [...this.nodes.values()].filter((node) =>
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
    this.labelPlacementBudget = {
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
        this.bindLabelInteraction(element, node);
        this.labelLayer.appendChild(element);
      }
      element.dataset.universeNodeId = node.id;
      element.disabled = this.timelineIsBusy();
      element.setAttribute("aria-label", this.text.exploreSource(node.sceneNode.label));
      element.style.setProperty(
        "--nebula-color",
        `#${this.sourceVisualColor(node.sourceId).getHexString()}`,
      );
      element.style.setProperty(
        "--nebula-phase",
        `${(-1.2 - stableUnit(`${node.id}:beacon-phase`) * 4.8).toFixed(2)}s`,
      );
      const title = element.querySelector("strong") as HTMLElement;
      title.textContent = node.sceneNode.label;
      const meta = element.querySelector("small") as HTMLElement;
      meta.textContent = node.sceneNode.statsReady
        ? this.text.sourceStats(node.sceneNode.eventCount, node.sceneNode.entityCount)
        : this.text.sourceStatsBuilding(node.sceneNode.eventCount);
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
        this.bindNodeLabelInteraction(element, primary, actionButtons, node);
        this.labelLayer.appendChild(element);
      }
      element.dataset.universeNodeId = node.id;
      primary.disabled = this.timelineIsBusy();
      actionButtons.forEach((button, index) => {
        button.disabled = this.timelineIsBusy() || (
          index === 0 && node.sceneNode.canExploreMore === false
        );
      });
      element.dataset.kind = node.kind;
      if (node.kind === "entity") {
        element.style.setProperty(
          "--universe-node-accent",
          `#${this.sourceVisualColor(node.sourceId).getHexString()}`,
        );
      } else {
        element.style.removeProperty("--universe-node-accent");
      }
      const locked = node.id === this.lockedId;
      element.dataset.locked = String(locked);
      element.dataset.expanded = String(
        locked || (node.kind === "event" && node.id === focusId && !transientHover),
      );
      element.dataset.compact = String(node.kind === "entity" && !locked);
      primary.setAttribute(
        "aria-label",
        this.text.exploreNode(nodeKind, node.sceneNode.label),
      );
      const eyebrowText = primary.querySelector(
        ".sag-universe-node-label__eyebrow > span:last-child",
      ) as HTMLElement;
      eyebrowText.textContent = `${this.text.kind(nodeKind)} · ${node.sceneNode.category}`;
      const title = primary.querySelector("strong") as HTMLElement;
      title.textContent = node.sceneNode.label;
      title.removeAttribute("title");
      const summary = primary.querySelector("p") as HTMLElement;
      const summaryText = node.sceneNode.description || (node.kind === "entity"
        ? this.text.relatedEvents(node.sceneNode.relatedCount, node.sceneNode.category)
        : node.sceneNode.category || this.text.extractedEvent);
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
        && !this.lockedId
        && !this.selectedId;
      exploreHint.hidden = !hintVisible;
      exploreHint.textContent = node.sceneNode.canExploreMore
        ? this.text.continueExploring(relatedProgress, relatedTotal)
        : typeof relatedTotal === "number" && relatedProgress >= relatedTotal
          ? this.text.explorationComplete(relatedProgress, relatedTotal)
          : this.text.explorationProgress(relatedProgress, relatedTotal);
      const actions = element.querySelector<HTMLElement>("[data-universe-node-actions]");
      if (actions) actions.hidden = !locked;
      const exploreMoreAction = this.text.exploreMoreAction ?? "Explore more";
      const askAiAction = this.text.askAiAction ?? "Ask AI";
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
    this.labels = nextLabels;
    this.host.dataset.universeReusedLabelCount = String(reusedLabelCount);
    this.host.dataset.universeEventLabelCandidateCount = String(
      activeNodes.filter((node) => node.kind === "event").length,
    );
    this.host.dataset.universeEntityLabelCandidateCount = String(
      activeNodes.filter((node) => node.kind === "entity").length,
    );
    this.sortLabelsForLayout();
    this.updateLabels(performance.now(), true);
    this.rebuildingLabels = false;
  }

  private sortLabelsForLayout() {
    const focusId = this.labelFocusId();
    const focusNeighbors = focusId
      ? this.adjacency.get(focusId) ?? new Set<string>()
      : null;
    this.labels.sort((left, right) => {
      const layoutRank = (label: SceneLabel) => {
        if (label.nodeId === this.lockedId) return 0;
        if (label.nodeId === this.selectedId) return 1;
        if (label.nodeId === this.keyboardFocusedId) return 2;
        if (label.nodeId === this.hoveredId) return 3;
        if (focusNeighbors?.has(label.nodeId)) return 4;
        return label.kind === "source" ? 5 : 6;
      };
      return layoutRank(left) - layoutRank(right);
    });
  }

  private bindLabelInteraction(element: HTMLButtonElement, node: ForceNode) {
    element.tabIndex = -1;
    const stopPointerPropagation = (event: PointerEvent) => event.stopPropagation();
    const holdCanvasFocus = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const focusNode = (event: PointerEvent) => {
      this.pointerActive = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.handleNodeHover(node, true);
    };
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.timelineIsBusy()) return;
      this.clearKeyboardFocus(false);
      this.callbacks.onNodeClick(node.sceneNode);
    });
    element.addEventListener("pointerdown", holdCanvasFocus);
    element.addEventListener("pointerup", stopPointerPropagation);
    element.addEventListener("pointercancel", stopPointerPropagation);
    element.addEventListener("pointerenter", focusNode);
    element.addEventListener("pointermove", focusNode, { passive: true });
    element.addEventListener("pointerleave", () => {
      if (!this.rebuildingLabels) this.handleNodeHover(null);
    });
  }

  private bindNodeLabelInteraction(
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
      this.pointerActive = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.handleNodeHover(node, true);
    };
    primary.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.timelineIsBusy()) return;
      this.clearKeyboardFocus(false);
      this.callbacks.onNodeClick(node.sceneNode);
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
        if (this.timelineIsBusy() || node.id !== this.lockedId) return;
        this.clearKeyboardFocus(false);
        if (index === 0) this.callbacks.onExploreMore?.(node.sceneNode);
        else this.callbacks.onAskNode?.(node.sceneNode);
      });
    });
    container.addEventListener("pointerenter", focusNode);
    container.addEventListener("pointermove", focusNode, { passive: true });
    container.addEventListener("pointerleave", () => {
      if (!this.rebuildingLabels) this.handleNodeHover(null);
    });
  }

  private updateLabels(now: number, force = false) {
    if (!force && now - this.lastLabelAt < 32) return;
    this.lastLabelAt = now;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const mobile = width < 768;
    const camera = this.graph.camera();
    // One layout read per pass. Previously each overlay lookup re-read the host
    // bounds, forcing repeated layout flushes while the camera was moving.
    const hostRect = this.host.getBoundingClientRect();
    const panelRect = this.miniPanelRect(hostRect);
    const summaryRect = this.relativeOverlayRect(
      "[data-universe-summary='true']",
      8,
      hostRect,
    );
    const progressRect = this.relativeOverlayRect(
      "[data-universe-load-progress='true']",
      8,
      hostRect,
    );
    const detailPanelRect = this.relativeOverlayRect(
      "[data-universe-detail-panel='true']",
      10,
      hostRect,
    );
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    let visibleEventLabels = 0;
    let visibleEntityLabels = 0;
    // Flight speed collapses cards through their own morph stages: full card →
    // eyebrow-only strip → bare star, and back once the camera settles.
    const cardMorph = universeCardMorph(this.visualDetailMix * this.flightCardPresence);
    const sourceReveal = 1 - THREE.MathUtils.smoothstep(this.visualDetailMix, 0, 0.72);
    const labelFocusId = this.labelFocusId();
    const transientHover = labelFocusId !== null
      && labelFocusId === this.transientHoverFocusId();
    const overviewCardOverride = Boolean(labelFocusId && this.visualDetailMix < 0.5);
    const nodeCardReveal = overviewCardOverride ? 1 : cardMorph.reveal;
    const nodeCardScale = overviewCardOverride ? 1 : cardMorph.scale;
    const nodeCardEyebrow = overviewCardOverride ? 1 : cardMorph.eyebrow;
    const nodeCardSummary = overviewCardOverride ? 1 : cardMorph.summary;
    const labelFocusNeighbors = labelFocusId
      ? this.adjacency.get(labelFocusId) ?? new Set<string>()
      : null;
    const focusCardIds = labelFocusId
      ? new Set([labelFocusId, ...(labelFocusNeighbors ?? [])])
      : null;
    const labelSourceId = labelFocusId
      ? this.nodes.get(labelFocusId)?.sourceId ?? this.visualSourceId
      : this.visualSourceId;
    // DOM labels sit above WebGL. Reserve a small screen-space target around
    // every visible event so an entity card cannot cover the star or steal its
    // hover/click interaction.
    const eventStarRadius = mobile ? 8 : 10;
    const eventStarRects = [...this.nodes.values()].flatMap((node) => {
      if (
        node.kind !== "event"
        || node.sourceId !== labelSourceId
        || (node.entryOpacity ?? 1)
          * (node.timelineOpacity ?? 1)
          * currentNodePresentationOpacity(node) <= 0.16
        || !Number.isFinite(node.x)
        || !Number.isFinite(node.y)
        || !Number.isFinite(node.z)
      ) return [];
      const scaledEventStarRadius = eventStarRadius
        * currentNodePresentationScale(node);
      const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
      const screen = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
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

    this.labels.forEach((label) => {
      const node = this.nodes.get(label.nodeId);
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
        label.element.hidden = true;
        label.element.style.display = "none";
        label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
        return;
      }
      const belongsToLabelSource = node.sourceId === labelSourceId;
      const requiredFocusCard = label.kind === "node"
        && Boolean(focusCardIds?.has(node.id));
      const kindPlacementFull = label.kind === "node" && !requiredFocusCard && (
        visibleEventLabels + visibleEntityLabels >= this.labelPlacementBudget.total
        || (node.kind === "event"
          ? visibleEventLabels >= this.labelPlacementBudget.events
          : visibleEntityLabels >= this.labelPlacementBudget.entities)
      );
      if (kindPlacementFull) {
        label.element.hidden = true;
        label.element.style.display = "none";
        label.element.style.pointerEvents = "none";
        label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
        return;
      }
      const sourceHovered = label.kind === "source"
        && !this.lockedId
        && !this.selectedId
        && node.id === (this.keyboardFocusedId ?? this.hoveredId);
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
      // Ember-level presence keeps the star but never a ghost card: remap so
      // cards are gone by the time a package has clearly been passed.
      const presenceForCards = THREE.MathUtils.clamp(
        ((node.temporalPresenceOpacity ?? 1) - 0.18) / 0.82,
        0,
        1,
      );
      const dataOpacity = currentNodePresentationOpacity(node)
        * (label.kind === "node" ? presenceForCards : 1);
      const entryReveal = label.kind === "node"
        ? THREE.MathUtils.clamp((
            (node.entryOpacity ?? 1) * (node.timelineOpacity ?? 1) - 0.16
          ) / 0.84, 0, 1)
        : 1;
      const calculatedOpacity = layoutOpacity * entryReveal * dataOpacity;
      const visibleOpacity = requiredFocusCard
        ? Math.max(0.72, calculatedOpacity)
        : calculatedOpacity;
      if (visibleOpacity <= 0.01) {
        label.element.hidden = true;
        label.element.style.display = "none";
        label.element.style.pointerEvents = "none";
        label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
        return;
      }
      const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
      const screen = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
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
        this.lockedId
        ?? this.selectedId
        ?? this.keyboardFocusedId
        ?? this.hoveredId
      );
      const locked = label.kind === "node" && node.id === this.lockedId;
      const expanded = locked || (node.kind === "event"
        && node.id === labelFocusId
        && !transientHover);
      const compact = label.kind === "node" && node.kind === "entity" && !locked;
      label.element.dataset.locked = String(locked);
      label.element.dataset.expanded = String(expanded);
      label.element.dataset.compact = String(compact);
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
      const labelScale = label.kind === "source"
        ? 1
        : nodeCardScale * currentNodePresentationCardScale(node);
      const labelWidth = baseLabelWidth * labelScale;
      const labelHeight = baseLabelHeight * labelScale;
      const labelGap = 3 + labelScale * 7;
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
        ? 18
        : Math.min(72, Math.max(40, labelWidth * 0.25));
      const nodeLabelGaps = compact || requiredFocusCard
        ? [labelGap, labelGap + focusGapStep, labelGap + focusGapStep * 2]
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
          detailPanelRect,
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
      const focusGridCandidates: LabelRect[] = [];
      if (requiredFocusCard) {
        const stepX = Math.max(72, labelWidth + 8);
        const stepY = Math.max(34, labelHeight + 8);
        for (let top = 58; top + labelHeight <= height - 42; top += stepY) {
          for (let left = 10; left + labelWidth <= width - 10; left += stepX) {
            const side: LabelSide = left + labelWidth / 2 >= screen.x ? "right" : "left";
            focusGridCandidates.push(makeRect(left, top, labelWidth, labelHeight, side));
          }
        }
        focusGridCandidates.sort((left, right) => {
          const distance = (rect: LabelRect) => Math.hypot(
            rect.left + labelWidth / 2 - screen.x,
            rect.top + labelHeight / 2 - screen.y,
          );
          return distance(left) - distance(right);
        });
      }
      const isOpenPlacement = (candidate: LabelRect) =>
        !blockedByViewportOrPanel(candidate)
        && !overlapsPlacedLabel(candidate)
        && !overlapsEventStar(candidate);
      const rect = candidates.find(isOpenPlacement)
        ?? clampedCandidates.find(isOpenPlacement)
        ?? focusGridCandidates.find(isOpenPlacement)
        ?? (requiredFocusCard || emphasized
          ? [...clampedCandidates, ...focusGridCandidates, ...candidates]
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
      label.element.dataset.highlighted = String(emphasized || this.sourceHits.some(
        (hit) => hit.source_id === node.sourceId,
      ));
      label.element.style.opacity = String(
        visibleOpacity * (
          emphasized ? 1 : label.kind === "source" ? 0.94 : 0.84
        ),
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
        label.element.style.setProperty(
          "--universe-card-eyebrow-opacity",
          nodeCardEyebrow.toFixed(3),
        );
        label.element.style.setProperty(
          "--universe-card-summary-opacity",
          nodeCardSummary.toFixed(3),
        );
        label.element.style.setProperty(
          "--universe-card-summary-y",
          `${((1 - nodeCardSummary) * 3).toFixed(2)}px`,
        );
        label.element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${labelScale})`;
      }
      if (visibleOpacity >= 0.22) placed.push(rect);
      if (label.kind === "node") {
        if (node.kind === "event") visibleEventLabels += 1;
        else visibleEntityLabels += 1;
      }
    });
    this.host.dataset.universeEventLabelCount = String(visibleEventLabels);
    this.host.dataset.universeEntityLabelCount = String(visibleEntityLabels);
  }

  private miniPanelRect(hostRect?: DOMRectReadOnly) {
    return this.relativeOverlayRect("[data-mini-workspace='true']", 10, hostRect);
  }

  private relativeOverlayRect(
    selector: string,
    padding: number,
    measuredHostRect?: DOMRectReadOnly,
  ) {
    const panel = document.querySelector<HTMLElement>(selector);
    if (!panel) return null;
    const hostRect = measuredHostRect ?? this.host.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const left = Math.max(0, rect.left - hostRect.left - padding);
    const top = Math.max(0, rect.top - hostRect.top - padding);
    const right = Math.min(hostRect.width, rect.right - hostRect.left + padding);
    const bottom = Math.min(hostRect.height, rect.bottom - hostRect.top + padding);
    if (right <= 0 || bottom <= 0 || left >= hostRect.width || top >= hostRect.height) return null;
    return { left, top, right, bottom };
  }

  private safeViewportCenter() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    let left = 24;
    let right = width - 72;
    let top = 68;
    let bottom = height - 54;
    const panels = [
      this.miniPanelRect(),
      this.relativeOverlayRect("[data-universe-detail-panel='true']", 10),
    ].filter((panel): panel is NonNullable<typeof panel> => panel !== null);
    panels.forEach((panel) => {
      const panelCenterX = (panel.left + panel.right) / 2;
      if (panelCenterX < width / 2) left = Math.max(left, panel.right + 18);
      else right = Math.min(right, panel.left - 18);
      const panelCenterY = (panel.top + panel.bottom) / 2;
      if (panel.bottom - panel.top > height * 0.62) {
        if (panelCenterY < height / 2) top = Math.max(top, panel.bottom + 16);
        else bottom = Math.min(bottom, panel.top - 16);
      }
    });
    if (right - left < width * 0.28) {
      left = 24;
      right = width - 72;
    }
    if (bottom - top < height * 0.28) {
      top = 68;
      bottom = height - 54;
    }
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }

  private moveCamera(
    point: THREE.Vector3,
    distance: number,
    duration: number,
    respectPanel = true,
    canonical = false,
  ) {
    this.pointerActive = false;
    this.lodArmed = false;
    if (this.hoveredId) this.handleNodeHover(null, false, true);
    this.wakeRendering(duration + 900);
    const camera = this.graph.camera() as THREE.PerspectiveCamera;
    if (!camera.isPerspectiveCamera || !Number.isFinite(camera.fov)) return;
    const safe = respectPanel
      ? this.safeViewportCenter()
      : { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 };
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const worldPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height;
    const shiftX = (safe.x - width / 2) * worldPerPixel;
    const shiftY = (height / 2 - safe.y) * worldPerPixel;
    camera.updateMatrixWorld();
    const cameraRight = canonical
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const cameraUp = canonical
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const lookAt = point
      .clone()
      .addScaledVector(cameraRight, -shiftX)
      .addScaledVector(cameraUp, -shiftY);
    const viewOffset = canonical
      ? new THREE.Vector3(0, 0, distance)
      : camera
          .getWorldDirection(new THREE.Vector3())
          .normalize()
          .multiplyScalar(-distance);
    const position = lookAt.clone().add(viewOffset);
    this.host.dataset.universeCamera = [
      position.x.toFixed(1),
      position.y.toFixed(1),
      position.z.toFixed(1),
      lookAt.x.toFixed(1),
      lookAt.y.toFixed(1),
      lookAt.z.toFixed(1),
    ].join(",");
    this.graph.cameraPosition(
      { x: position.x, y: position.y, z: position.z },
      { x: lookAt.x, y: lookAt.y, z: lookAt.z },
      this.reducedMotion ? 0 : duration,
    );
    this.startLoop(this.reducedMotion ? 80 : duration + 180);
  }

  private projectedSourceRadius(node: ForceNode, cameraRight: THREE.Vector3) {
    const center = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
    const edge = new THREE.Vector3(node.x, node.y, node.z).addScaledVector(
      cameraRight,
      node.sceneNode.radius,
    );
    const projectedEdge = this.graph.graph2ScreenCoords(edge.x, edge.y, edge.z);
    const radiusPx = Math.hypot(projectedEdge.x - center.x, projectedEdge.y - center.y);
    return Number.isFinite(radiusPx) ? radiusPx : null;
  }

  private updateVisualLayout(now: number, force = false, refresh = true) {
    const elapsed = this.lastVisualLodAt > 0
      ? Math.max(1, now - this.lastVisualLodAt)
      : 32;
    if (!force && elapsed < 24) return;
    this.lastVisualLodAt = now;
    const camera = this.graph.camera();
    camera.updateMatrixWorld();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    let best: {
      node: ForceNode;
      radiusPx: number;
      score: number;
    } | null = null;
    this.nodes.forEach((node) => {
      if (node.kind !== "source") return;
      const center = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
      const projectedCenter = new THREE.Vector3(node.x, node.y, node.z).project(camera);
      const radiusPx = this.projectedSourceRadius(node, cameraRight);
      if (radiusPx === null) return;
      const distancePx = Math.hypot(center.x - width / 2, center.y - height / 2);
      const inFrame = projectedCenter.z > -1
        && projectedCenter.z < 1
        && center.x > -80
        && center.x < width + 80
        && center.y > -80
        && center.y < height + 80
        && distancePx <= radiusPx + Math.min(width, height) * 0.34;
      if (!inFrame) return;
      const score = radiusPx
        - distancePx * 0.45
        + (node.sourceId === (this.latchedDetailSourceId ?? this.visualSourceId)
          ? this.policy.lod_hysteresis_px
          : 0);
      if (!best || score > best.score) best = { node, radiusPx, score };
    });

    const inferredVisual = best as { node: ForceNode; radiusPx: number; score: number } | null;
    const suppressDetail = this.overviewRequested;
    const previousVisualNode = this.visualSourceId
      ? [...this.nodes.values()].find(
          (node) => node.kind === "source" && node.sourceId === this.visualSourceId,
        )
      : undefined;
    const resetVisual = previousVisualNode ?? inferredVisual?.node;
    const resetRadiusPx = resetVisual
      ? this.projectedSourceRadius(resetVisual, cameraRight)
      : null;
    if (
      suppressDetail
      && (resetRadiusPx === null || resetRadiusPx <= this.policy.lod_orbit_px)
    ) {
      this.overviewRequested = false;
    }
    const currentSource = this.latchedDetailSourceId
      ? [...this.nodes.values()].find(
          (node) => node.kind === "source" && node.sourceId === this.latchedDetailSourceId,
        )
      : undefined;
    const currentRadiusPx = currentSource
      ? this.projectedSourceRadius(currentSource, cameraRight)
      : null;
    const explicitAnchor = this.nodes.get(this.lockedId ?? this.selectedId ?? "");
    let explicitSource: ForceNode | undefined;
    if (
      explicitAnchor
      && explicitAnchor.kind !== "source"
      && camera.position.distanceTo(new THREE.Vector3(
        explicitAnchor.x,
        explicitAnchor.y,
        explicitAnchor.z,
      )) <= 220
    ) {
      explicitSource = [...this.nodes.values()].find(
        (node) => node.kind === "source" && node.sourceId === explicitAnchor.sourceId,
      );
    }

    // An active browse session owns the detail latch. The radius heuristic
    // measures distance to the source's centre, but flight travels along the
    // axis away from that centre by design — letting the heuristic unlatch
    // mid-flight would hide every card, collapse the nebula corridor and
    // re-enable the overview drift while the user is inside the source.
    const browseDetailSourceId = this.timelineJourney.enabled && this.flightConfig
      ? this.flightConfig.sourceId
      : null;
    const nextLatchedSourceId = suppressDetail
      ? null
      : browseDetailSourceId ?? resolveUniverseDetailSource({
          currentSourceId: this.latchedDetailSourceId,
          currentRadiusPx,
          candidateSourceId: inferredVisual?.node.sourceId ?? null,
          candidateRadiusPx: inferredVisual?.radiusPx ?? null,
          explicitSourceId: this.requestedSourceId ?? explicitSource?.sourceId,
          enterRadiusPx: this.policy.lod_near_px,
          exitRadiusPx: this.policy.lod_orbit_px,
        });
    const previousSourceId = this.visualSourceId;
    const previousMix = this.visualDetailMix;
    const previousReportedSourceId = this.reportedViewSourceId;
    const latchChanged = nextLatchedSourceId !== this.latchedDetailSourceId;
    this.latchedDetailSourceId = nextLatchedSourceId;
    const latchedVisual = nextLatchedSourceId
      ? [...this.nodes.values()].find(
          (node) => node.kind === "source" && node.sourceId === nextLatchedSourceId,
        )
      : undefined;
    const visual = suppressDetail
      ? previousVisualNode
      : latchedVisual ?? explicitSource ?? inferredVisual?.node;
    const visualRadiusPx = visual
      ? this.projectedSourceRadius(visual, cameraRight)
      : null;
    const naturalTarget = browseDetailSourceId
      && visual?.sourceId === browseDetailSourceId
      ? 1
      : visual
        ? universeVisualDetailProgress(
            visualRadiusPx,
            this.policy.lod_orbit_px,
            this.policy.lod_near_px,
            this.policy.lod_deep_px,
          )
        : 0;
    const nextTarget = this.requestedSourceId === visual?.sourceId
      ? Math.max(previousMix, naturalTarget)
      : naturalTarget;
    if (
      this.requestedSourceId === visual?.sourceId
      && naturalTarget >= 0.5
    ) {
      this.requestedSourceId = null;
    }
    this.visualDetailTarget = nextTarget;
    let nextSourceId = nextTarget > 0.001 || nextLatchedSourceId
      ? visual?.sourceId ?? null
      : previousSourceId;
    const response = this.reducedMotion
      ? 1
      : 1 - Math.exp(-elapsed / DETAIL_MORPH_RESPONSE_MS);
    let nextMix = THREE.MathUtils.lerp(previousMix, nextTarget, response);
    if (Math.abs(nextTarget - nextMix) <= DETAIL_MORPH_SETTLE_EPSILON) {
      nextMix = nextTarget;
    }
    if (
      !this.reducedMotion
      && Math.abs(nextTarget - nextMix) > DETAIL_MORPH_SETTLE_EPSILON
    ) {
      this.loopKeepAliveUntil = Math.max(
        this.loopKeepAliveUntil,
        now + DETAIL_MORPH_RESPONSE_MS * 4,
      );
    }
    if (nextMix <= 0.002 && nextTarget === 0 && !nextLatchedSourceId) {
      nextMix = 0;
      nextSourceId = null;
    }
    const nextReportedSourceId = nextMix >= 0.5 ? nextSourceId : null;
    const sourceChanged = nextSourceId !== previousSourceId;
    const mixChanged = Math.abs(nextMix - previousMix) >= 0.002;
    const reportedChanged = nextReportedSourceId !== previousReportedSourceId;
    if (!force && !latchChanged && !sourceChanged && !mixChanged && !reportedChanged) return;

    this.visualSourceId = nextSourceId;
    this.visualDetailMix = nextMix;
    this.reportedViewSourceId = nextReportedSourceId;
    this.host.dataset.universeVisualMode = nextReportedSourceId ? "detail" : "overview";
    this.host.dataset.universeDetailSource = nextReportedSourceId ?? "";
    this.host.dataset.universeDetailLatched = this.latchedDetailSourceId ?? "";
    this.host.dataset.universeDetailMix = nextMix.toFixed(2);
    this.host.dataset.universeDetailTarget = nextTarget.toFixed(2);
    this.updateNodeMorphScales(now, true);
    this.updateSourceAuraOpacities();
    this.updateNebulaAlphas();
    this.updateNebulaMotionState();
    this.nodes.forEach((node) => {
      if (node.kind !== "source") return;
      node.object?.traverse((child) => {
        if (!child.userData.hitArea) return;
        child.visible = node.sourceId !== nextSourceId || nextMix < 0.62;
      });
    });
    const hovered = this.hoveredId ? this.nodes.get(this.hoveredId) : undefined;
    const hoveredStillVisible = hovered?.kind === "source"
      ? hovered.sourceId !== nextReportedSourceId
      : hovered?.sourceId === nextReportedSourceId;
    if (hovered && !hoveredStillVisible) {
      this.hoveredId = null;
      this.hoveredFromLabel = false;
      this.callbacks.onHover(null);
    }
    const keyboardNode = this.keyboardFocusedId
      ? this.nodes.get(this.keyboardFocusedId)
      : undefined;
    const keyboardStillEligible = nextReportedSourceId
      ? keyboardNode?.kind !== "source"
        && keyboardNode?.sourceId === nextReportedSourceId
      : Boolean(keyboardNode);
    if (keyboardNode && !keyboardStillEligible) {
      this.clearKeyboardFocus(true, false);
    } else if (keyboardNode && (reportedChanged || sourceChanged)) {
      this.updateKeyboardStatus();
    }
    this.callbacks.onViewChange({
      mode: nextReportedSourceId ? "detail" : "overview",
      sourceId: nextReportedSourceId,
      progress: nextMix,
    });
    if (!refresh) return;
    if (reportedChanged || sourceChanged) {
      this.rebuildLabels();
      this.applyHighlight();
    } else this.updateLabels(now, true);
  }

  private evaluateLod(now: number) {
    if (!this.interactive || !this.lodArmed || now - this.lastLodAt < 110) return;
    this.lastLodAt = now;
    const camera = this.graph.camera();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    let best: { node: ForceNode; radiusPx: number; distance: number } | null = null;
    this.nodes.forEach((node) => {
      if (node.kind !== "source") return;
      if (this.latchedDetailSourceId && node.sourceId !== this.latchedDetailSourceId) return;
      const center = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
      if (center.x < -80 || center.x > width + 80 || center.y < -80 || center.y > height + 80) return;
      const edge = new THREE.Vector3(node.x, node.y, node.z).addScaledVector(
        cameraRight,
        node.sceneNode.radius,
      );
      const projectedEdge = this.graph.graph2ScreenCoords(edge.x, edge.y, edge.z);
      const radiusPx = Math.hypot(projectedEdge.x - center.x, projectedEdge.y - center.y);
      const distance = Math.hypot(center.x - width / 2, center.y - height / 2);
      if (distance > radiusPx + Math.min(width, height) * 0.34) return;
      if (!best || radiusPx > best.radiusPx || (radiusPx === best.radiusPx && distance < best.distance)) {
        best = { node, radiusPx, distance };
      }
    });
    if (!best) return;
    const candidate = best as { node: ForceNode; radiusPx: number; distance: number };
    const previous = this.lodLevels.get(candidate.node.sourceId) ?? 0;
    const hysteresis = this.policy.lod_hysteresis_px;
    let level: 0 | 1 | 2 | 3;
    if (candidate.radiusPx >= this.policy.lod_deep_px - (previous === 3 ? hysteresis : 0)) level = 3;
    else if (candidate.radiusPx >= this.policy.lod_near_px - (previous >= 2 ? hysteresis : 0)) level = 2;
    else if (candidate.radiusPx >= this.policy.lod_orbit_px - (previous >= 1 ? hysteresis : 0)) level = 1;
    else level = 0;
    const deepMilestone = level === 3
      ? universeDeepLoadMilestone(
          candidate.radiusPx,
          this.policy.lod_deep_px,
          this.policy.lod_hysteresis_px,
        )
      : 0;
    const previousDeepMilestone = this.deepLodMilestones.get(candidate.node.sourceId) ?? 0;
    const deepMilestoneAdvanced = level === 3 && deepMilestone > previousDeepMilestone;
    if (level === previous && !deepMilestoneAdvanced) return;
    this.pendingLod = {
      sourceId: candidate.node.sourceId,
      level,
      deepMilestone,
      notify: level !== 3 || deepMilestoneAdvanced,
    };
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    this.lodTimer = window.setTimeout(() => {
      this.lodTimer = null;
      if (!this.pendingLod) return;
      this.lodLevels.set(this.pendingLod.sourceId, this.pendingLod.level);
      if (this.pendingLod.deepMilestone > 0) {
        this.deepLodMilestones.set(
          this.pendingLod.sourceId,
          Math.max(
            this.deepLodMilestones.get(this.pendingLod.sourceId) ?? 0,
            this.pendingLod.deepMilestone,
          ),
        );
      }
      if (this.pendingLod.notify) {
        this.callbacks.onSourceLod(this.pendingLod.sourceId, this.pendingLod.level);
      }
      this.pendingLod = null;
    }, this.policy.lod_debounce_ms);
  }

  private startLoop(keepAliveMs = 0) {
    if (keepAliveMs > 0) {
      this.loopKeepAliveUntil = Math.max(
        this.loopKeepAliveUntil,
        performance.now() + keepAliveMs,
      );
    }
    if (this.paused || this.loopFrame !== null) return;
    this.host.dataset.universeLoop = "active";
    this.loopFrame = requestAnimationFrame(this.loop);
  }

  private wakeRendering(settleMs = 1800) {
    if (this.paused) return;
    if (!this.renderingAwake) {
      // resumeAnimation synchronously emits a controls change, so arm the guard first.
      this.renderingAwake = true;
      this.graph.resumeAnimation();
    }
    this.host.dataset.universeRenderer = "active";
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => {
      this.sleepTimer = null;
      if (
        this.paused
        || performance.now() < this.loopKeepAliveUntil
      ) {
        if (!this.paused) this.wakeRendering(500);
        return;
      }
      if (
        !this.reducedMotion
        && performance.now() - this.lastControlsChangeAt < CAMERA_DAMPING_QUIET_MS
      ) {
        this.wakeRendering(CAMERA_DAMPING_RECHECK_MS);
        return;
      }
      this.graph.pauseAnimation();
      this.renderingAwake = false;
      this.host.dataset.universeRenderer = "sleeping";
    }, this.reducedMotion ? Math.min(520, settleMs) : settleMs);
  }

  private loop = (now: number) => {
    this.loopFrame = null;
    if (this.paused || document.visibilityState !== "visible") {
      this.host.dataset.universeLoop = "idle";
      return;
    }
    const entering = this.updateNodeEntries(now);
    const timelineMoving = this.updateTimelineMotions(now);
    const flightMoving = this.updateTemporalFlight(now);
    const parallaxMoving = this.updatePointerParallax();
    this.updateVisualLayout(now);
    const nebulaAnimating = this.updateNebulaAnimation(now);
    this.updateLabels(now);
    this.evaluateLod(now);
    if (
      entering
      || timelineMoving
      || flightMoving
      || parallaxMoving
      || nebulaAnimating
      || now < this.loopKeepAliveUntil
    ) {
      this.loopFrame = requestAnimationFrame(this.loop);
    } else {
      this.host.dataset.universeLoop = "idle";
    }
  };

  /**
   * Brand-style pointer parallax: the gaze leans faintly toward the cursor,
   * eased every frame, applied as deltas to the orbit target so it composes
   * with the user's own drags. Bounded to a whisper — alive, never floaty.
   */
  private updatePointerParallax() {
    const target = this.controls.target;
    if (!target) return false;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const active = this.browseGazeApplied
      && !this.reducedMotion
      && this.pointerActive
      && !this.paused;
    const ndcX = THREE.MathUtils.clamp((this.pointerX / width - 0.5) * 2, -1, 1);
    const ndcY = THREE.MathUtils.clamp((this.pointerY / height - 0.5) * 2, -1, 1);
    const desiredX = active ? ndcX * BROWSE_PARALLAX_X : 0;
    const desiredY = active ? -ndcY * BROWSE_PARALLAX_Y : 0;
    const nextX = THREE.MathUtils.lerp(
      this.parallaxApplied.x,
      desiredX,
      BROWSE_PARALLAX_RESPONSE,
    );
    const nextY = THREE.MathUtils.lerp(
      this.parallaxApplied.y,
      desiredY,
      BROWSE_PARALLAX_RESPONSE,
    );
    const dx = nextX - this.parallaxApplied.x;
    const dy = nextY - this.parallaxApplied.y;
    if (Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002) return false;
    this.parallaxApplied = { x: nextX, y: nextY };
    const camera = this.graph.camera();
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
  private updateTemporalPresence() {
    const config = this.flightConfig;
    let linksDirty = false;
    // Before the camera has crossed the vestibule, the source is still the
    // intact nebula: no event stars, no cards — the initial state. They
    // condense in as the dive progresses and dissolve on the way back out.
    const dive = config && config.vestibuleDepth > 0
      ? THREE.MathUtils.smoothstep(
          this.appliedFlightDepth,
          0,
          config.vestibuleDepth * 0.85,
        )
      : 1;
    this.nodes.forEach((node) => {
      let scale = 1;
      let opacity = 1;
      if (config && node.kind !== "source" && node.sourceId === config.sourceId) {
        const nodeDepth = config.centerZ - node.z;
        const presence = universeTemporalFlightPresence(
          nodeDepth - this.appliedFlightDepth,
          config.unitsPerEvent,
        );
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
      this.setObjectOpacity(
        node,
        node.visualOpacity ?? 1,
        node.visuallyEmphasized ?? false,
      );
    });
    if (linksDirty) this.updateLinkVisuals();
  }

  /**
   * Advances the flight each frame: integrates the state, translates camera and
   * orbit target together by the depth delta, and pages the window when the
   * camera nears its edge. The camera never waits for data — a page that isn't
   * loaded yet simply condenses in once it lands.
   */
  private updateTemporalFlight(now: number) {
    const config = this.flightConfig;
    if (!config || !this.timelineJourney.enabled || !this.interactive) {
      this.lastFlightStepAt = now;
      return false;
    }
    const elapsedMs = this.lastFlightStepAt > 0 ? now - this.lastFlightStepAt : 16;
    this.lastFlightStepAt = now;
    const { state, moving } = stepUniverseTemporalFlight(this.flightState, {
      elapsedMs,
      maxDepth: config.maxDepth,
      reducedMotion: this.reducedMotion,
    });
    this.flightState = state;
    const delta = state.depth - this.appliedFlightDepth;
    if (delta !== 0) {
      this.appliedFlightDepth = state.depth;
      const camera = this.graph.camera();
      camera.position.z -= delta;
      if (this.controls.target) this.controls.target.z -= delta;
      this.syncNebulaCorridorUniforms();
      this.wakeRendering(600);
      this.updateTemporalPresence();
      this.updateVisualLayout(now);
      this.updateNodeMorphScales(now);
      this.updateLabels(now);
      this.evaluateLod(now);
    }
    // Cards duck while the camera streaks past and re-expand once it settles.
    // Speed comes from actual depth travel, so wheel inertia and button glides
    // behave identically.
    const instantSpeed = Math.abs(delta) / Math.max(1, elapsedMs) * 1000;
    this.flightSpeed += (instantSpeed - this.flightSpeed)
      * (1 - Math.exp(-elapsedMs / 140));
    const cardTarget = 1 - THREE.MathUtils.smoothstep(
      this.flightSpeed,
      FLIGHT_CARD_CALM_SPEED,
      FLIGHT_CARD_HIDE_SPEED,
    );
    const cardResponse = 1 - Math.exp(-elapsedMs / (
      cardTarget < this.flightCardPresence
        ? FLIGHT_CARD_COLLAPSE_MS
        : FLIGHT_CARD_RECOVER_MS
    ));
    const nextCardPresence = THREE.MathUtils.lerp(
      this.flightCardPresence,
      cardTarget,
      cardResponse,
    );
    const cardsSettling = Math.abs(nextCardPresence - this.flightCardPresence) > 0.002;
    if (cardsSettling) {
      this.flightCardPresence = nextCardPresence;
      this.host.dataset.universeFlightCardPresence = nextCardPresence.toFixed(2);
      if (delta === 0) this.updateLabels(now);
    }
    this.host.dataset.universeFlightDepth = state.depth.toFixed(1);
    this.host.dataset.universeFlightVelocity = state.velocity.toFixed(1);
    const follow = now >= this.flightFollowCooldownUntil
      ? planUniverseTemporalFlightFollow({
          depth: state.depth,
          windowNearDepth: config.windowNearDepth,
          windowFarDepth: config.windowFarDepth,
          marginUnits: config.unitsPerEvent * 1.5,
          // Fast flight pages ahead of arrival: the corridor must keep
          // condensing in front of the camera, not behind it.
          velocity: state.velocity,
          busy: this.timelineIsBusy(),
          hasNext: this.timelineJourney.hasNext,
          hasPrevious: this.timelineJourney.hasPrevious,
        })
      : null;
    if (follow) {
      this.flightOwnWindowChange = true;
      void Promise.resolve(this.moveTimeline(follow)).then((result) => {
        if (result === "advanced") return;
        this.flightOwnWindowChange = false;
        this.flightFollowCooldownUntil = performance.now() + 500;
      });
    }
    return moving || cardsSettling;
  }

  private timelineWheelSurface(target: EventTarget | null): "canvas" | "label" | null {
    if (target === this.rendererCanvas) return "canvas";
    if (!(target instanceof Element) || !this.host.contains(target)) return null;
    if (target.closest("[data-universe-detail-panel='true']")) return null;
    const label = target.closest<HTMLElement>(TIMELINE_WHEEL_LABEL_SELECTOR);
    return label && this.labelLayer.contains(label) ? "label" : null;
  }

  private forwardTimelineWheelToCanvas(event: WheelEvent) {
    const forwarded = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
    // The clone must pass through the host capture listener before reaching
    // OrbitControls. Mark it so pagination is planned exactly once while the
    // canvas still receives the same zoom gesture as the DOM label above it.
    this.forwardedTimelineWheelEvents.add(forwarded);
    this.rendererCanvas.dispatchEvent(forwarded);
  }

  private handleTimelineWheel = (event: WheelEvent) => {
    if (this.paused || !this.interactive) return;
    if (this.forwardedTimelineWheelEvents.has(event)) {
      this.forwardedTimelineWheelEvents.delete(event);
      return;
    }
    const surface = this.timelineWheelSurface(event.target);
    if (!surface) return;
    this.callbacks.onUserInteraction?.();
    if (this.lockedId || this.selectedId || this.keyboardFocusedId) {
      // Dismiss reading focus first, but keep processing this exact wheel
      // gesture so the camera never feels as though it swallowed an input.
      this.callbacks.onSelectionClear();
      if (this.lockedId || this.selectedId || this.keyboardFocusedId) {
        this.clearSelection();
      }
    }
    const flightActive = this.timelineJourney.enabled && this.flightConfig !== null;
    if (!flightActive || event.ctrlKey || event.metaKey) {
      // Overview zoom and pinch belong to OrbitControls. Its listener lives on
      // the canvas, and the label layer never bubbles into it, so forward a
      // clone when the pointer rests on a label.
      if (surface === "label") this.forwardTimelineWheelToCanvas(event);
      return;
    }
    // In flight the wheel has exactly one meaning. Consuming the event in the
    // capture phase keeps OrbitControls' canvas listener from also zooming.
    event.preventDefault();
    event.stopPropagation();
    this.flightState = applyUniverseTemporalFlightWheel(this.flightState, {
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      viewportHeight: this.host.clientHeight,
      reducedMotion: this.reducedMotion,
    });
    this.wakeRendering(900);
    this.startLoop(900);
  };

  private handlePointerDown = (event: PointerEvent) => {
    if (this.paused || !this.interactive) return;
    if (!this.timelineWheelSurface(event.target)) return;
    this.callbacks.onUserInteraction?.();
    // A deliberate grab owns the camera immediately and brakes the flight.
    this.flightState = brakeUniverseTemporalFlight(this.flightState);
  };

  private handleControlsStart = () => {
    if (this.paused || !this.interactive) return;
    this.wakeRendering(1_400);
    // A camera gesture wants a steady sky: freeze the ambient drift instead of
    // igniting it, so the background never floats under the user's hand.
    this.cameraCalmUntil = performance.now() + NEBULA_GESTURE_CALM_MS;
    this.lodArmed = true;
    this.startLoop(this.policy.lod_debounce_ms + 240);
  };

  private handleControlsChange = () => {
    if (this.paused) return;
    const now = performance.now();
    this.lastControlsChangeAt = now;
    this.cameraCalmUntil = now + NEBULA_GESTURE_CALM_MS;
    this.updateVisualLayout(now);
    this.updateNodeMorphScales(now);
    this.updateLabels(now);
    this.evaluateLod(now);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (this.paused || !this.interactive) return;
    if (!this.renderingAwake) this.wakeRendering(900);
    this.pointerActive = true;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (this.hoveredFromLabel && this.hoveredId) {
      const target = event.target;
      const label = target instanceof Element
        ? target.closest<HTMLElement>("[data-universe-node-id]")
        : null;
      if (label?.dataset.universeNodeId !== this.hoveredId) this.handleNodeHover(null);
    }
  };

  private handlePointerEnter = () => {
    if (this.paused || !this.interactive) return;
    this.wakeRendering(900);
    this.armNebulaAnimation(900);
  };

  private handlePointerLeave = () => {
    if (this.paused) return;
    this.pointerActive = false;
    if (this.hoveredId) this.handleNodeHover(null, false, true);
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState !== "visible" || !this.interactive) return;
    this.resume();
    this.updateNebulaMotionState();
    this.wakeRendering(1200);
    this.startLoop();
    this.armNebulaAnimation();
  };

  private handleWebglContextLost = (event: Event) => {
    event.preventDefault();
    if (this.unavailableNotified) return;
    this.unavailableNotified = true;
    this.host.dataset.universeEngine = "context-lost";
    this.pause();
    this.callbacks.onUnavailable("context-lost");
  };

  private handleWindowPointerMove = (event: PointerEvent) => {
    if (this.paused || !this.interactive) return;
    const target = event.target;
    if (!(target instanceof Node) || this.host.contains(target)) return;
    this.pointerActive = false;
    if (this.hoveredId) this.handleNodeHover(null, false, true);
  };

  private keyboardCandidates() {
    const detailSourceId = this.visualDetailMix >= 0.5 ? this.visualSourceId : null;
    const camera = this.graph.camera();
    camera.updateMatrixWorld();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const inViewport = (node: ForceNode) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
        return false;
      }
      const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
      const screen = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
      return projected.z > -1
        && projected.z < 1
        && screen.x >= 0
        && screen.x <= width
        && screen.y >= 0
        && screen.y <= height;
    };
    const candidates = [...this.nodes.values()].filter((node) => {
      if (
        (node.entryOpacity ?? 1)
          * (node.timelineOpacity ?? 1)
          * currentNodePresentationOpacity(node) <= 0.12
      ) return false;
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

  private updateKeyboardStatus(candidates = this.keyboardCandidates()) {
    const node = this.keyboardFocusedId
      ? this.nodes.get(this.keyboardFocusedId)
      : undefined;
    const index = node ? candidates.findIndex((candidate) => candidate.id === node.id) : -1;
    this.host.dataset.universeKeyboardCandidateCount = String(candidates.length);
    this.host.dataset.universeKeyboardIndex = index >= 0 ? String(index + 1) : "";
    if (!node || index < 0) {
      this.keyboardStatusElement.textContent = "";
      return;
    }
    const label = node.kind === "source"
      ? this.text.exploreSource(node.sceneNode.label)
      : this.text.exploreNode(node.kind, node.sceneNode.label);
    this.keyboardStatusElement.textContent = this.text.keyboardStatus(
      label,
      index + 1,
      candidates.length,
    );
  }

  private clearKeyboardFocus(notify = true, refresh = true) {
    if (!this.keyboardFocusedId) {
      this.updateKeyboardStatus([]);
      return;
    }
    this.keyboardFocusedId = null;
    this.host.dataset.universeKeyboardNodeId = "";
    this.updateKeyboardStatus([]);
    if (notify) this.callbacks.onHover(null);
    if (!refresh || !this.dataReady) return;
    this.applyHighlight();
    this.scheduleHoverLabelRebuild(true);
  }

  private setKeyboardFocus(nodeId: string, candidates: ForceNode[]) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.cancelHoverClear();
    this.hoveredId = null;
    this.hoveredFromLabel = false;
    this.keyboardFocusedId = nodeId;
    this.host.dataset.universeKeyboardNodeId = nodeId;
    this.wakeRendering(700);
    this.applyHighlight();
    this.scheduleHoverLabelRebuild(true);
    this.updateKeyboardStatus(candidates);
    const screen = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
    const hostRect = this.host.getBoundingClientRect();
    this.callbacks.onHover({
      node: node.sceneNode,
      x: hostRect.left + screen.x,
      y: hostRect.top + screen.y,
    });
  }

  private handleCanvasFocus = () => {
    if (this.paused || !this.interactive) return;
    this.keyboardActive = true;
    this.host.dataset.universeKeyboardActive = "true";
    this.updateKeyboardStatus();
  };

  private handleCanvasBlur = () => {
    if (!this.keyboardActive) return;
    this.keyboardActive = false;
    this.host.dataset.universeKeyboardActive = "false";
    this.clearKeyboardFocus();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.paused || !this.interactive || event.target !== this.host) return;
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (this.timelineIsBusy() && event.key !== "Escape") {
      if (
        event.key.startsWith("Arrow")
        || event.key === "Enter"
        || event.key === " "
        || event.key === "Space"
        || event.key === "Spacebar"
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    const direction: UniverseKeyboardDirection | null = event.key === "ArrowRight"
      || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : null;
    if (direction !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onUserInteraction?.();
      const candidates = this.keyboardCandidates();
      const nextId = nextUniverseKeyboardNodeId(
        candidates.map((candidate) => candidate.id),
        this.keyboardFocusedId,
        direction,
      );
      if (nextId) this.setKeyboardFocus(nextId, candidates);
      else this.clearKeyboardFocus();
      return;
    }
    if (
      event.key === "Enter"
      || event.key === " "
      || event.key === "Space"
      || event.key === "Spacebar"
    ) {
      if (!this.keyboardFocusedId) return;
      event.preventDefault();
      event.stopPropagation();
      const node = this.keyboardCandidates().find(
        (candidate) => candidate.id === this.keyboardFocusedId,
      );
      if (!node) {
        this.clearKeyboardFocus();
        return;
      }
      if (event.repeat) return;
      this.callbacks.onNodeClick(node.sceneNode);
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.clearKeyboardFocus();
    if (this.hoveredId) this.handleNodeHover(null, false, true);
    if (this.lockedId || this.selectedId) this.callbacks.onSelectionClear();
  };

  private updatePixelRatio() {
    const mobile = this.host.clientWidth < 768;
    const concreteNodes = [...this.nodes.values()].filter((node) => node.kind !== "source").length;
    const qualityCap = this.reducedMotion
      ? 1
      : mobile
        ? concreteNodes > 220 ? 1 : 1.18
        : concreteNodes > 600 ? 1.18 : concreteNodes > 320 ? 1.32 : 1.5;
    const cssPixelArea = Math.max(1, this.host.clientWidth * this.host.clientHeight);
    const renderPixelBudget = mobile
      ? MAX_RENDER_PIXELS_MOBILE
      : MAX_RENDER_PIXELS_DESKTOP;
    const areaCap = Math.sqrt(renderPixelBudget / cssPixelArea);
    const pixelRatio = Math.max(
      0.75,
      Math.min(window.devicePixelRatio || 1, qualityCap, areaCap),
    );
    const nebulaPointSizeCap = (
      mobile
        ? NEBULA_GLOW_POINT_SIZE_CSS_MOBILE
        : NEBULA_GLOW_POINT_SIZE_CSS_DESKTOP
    ) * pixelRatio;
    this.host.dataset.universePixelRatio = pixelRatio.toFixed(2);
    this.host.dataset.universeNebulaPointSizeCap = nebulaPointSizeCap.toFixed(1);
    this.host.dataset.universeRenderPixels = String(
      Math.round(cssPixelArea * pixelRatio * pixelRatio),
    );
    if (this.currentPixelRatio === null || Math.abs(this.currentPixelRatio - pixelRatio) > 0.001) {
      this.currentPixelRatio = pixelRatio;
      this.graph.renderer().setPixelRatio(pixelRatio);
    }
    if (this.nebulaPoints) {
      const material = this.nebulaPoints.material as THREE.ShaderMaterial;
      material.uniforms.uPixelRatio.value = pixelRatio;
      material.uniforms.uPointSizeCap.value = nebulaPointSizeCap;
    }
  }

  private handleResize = () => {
    if (this.paused) {
      this.resizePending = true;
      return;
    }
    this.resizePending = false;
    this.wakeRendering(1000);
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.graph.width(width).height(height);
    this.updatePixelRatio();
    this.updateVisualLayout(performance.now(), true, false);
    this.rebuildLabels();
    this.applyHighlight();
  };
}

export const UniverseScene = React.forwardRef<UniverseSceneHandle, UniverseSceneProps>(
  function UniverseScene(
    {
      data,
      policy,
      sourceHits,
      selectedId,
      darkTheme,
      interactive,
      reducedMotion,
      viewPreferences,
      timelineJourney,
      onNodeClick,
      onHover,
      onViewChange,
      onSourceLod,
      onSelectionClear,
      actionLabels,
      onExploreMore,
      onAskNode,
      onUserInteraction,
      onTimelineIntent,
      onTimelineSettled,
      onUnavailable,
    },
    forwardedRef,
  ) {
    const locale = useLocale();
    const t = useTranslations("UniverseScene");
    const text = React.useMemo<UniverseSceneText>(() => ({
      locale,
      aria: t("aria"),
      keyboardInstructions: t("keyboardInstructions"),
      keyboardStatus: (label, index, total) => t("keyboardStatus", {
        label,
        index,
        total,
      }),
      exploreSource: (label) => t("exploreSource", { label }),
      sourceStats: (events, entities) => t("sourceStats", { events, entities }),
      sourceStatsBuilding: (events) => t("sourceStatsBuilding", { events }),
      exploreNode: (kind, label) => t("exploreNode", {
        kind: t(`kinds.${kind}`),
        label,
      }),
      kind: (kind) => t(`kinds.${kind}`),
      relatedEvents: (count, category) => t("relatedEvents", { count, category }),
      continueExploring: (progress, total) => t("continueExploring", { progress, total }),
      explorationProgress: (progress, total) => t("explorationProgress", { progress, total }),
      explorationComplete: (progress, total) => t("explorationComplete", { progress, total }),
      extractedEvent: t("extractedEvent"),
      exploreMoreAction: actionLabels?.exploreMore,
      askAiAction: actionLabels?.askAi,
    }), [actionLabels?.askAi, actionLabels?.exploreMore, locale, t]);
    const keyboardInstructionsId = React.useId();
    const hostRef = React.useRef<HTMLDivElement>(null);
    const keyboardStatusRef = React.useRef<HTMLSpanElement>(null);
    const engineRef = React.useRef<UniverseForceSceneEngine | null>(null);
    const latestRef = React.useRef({
      data,
      policy,
      sourceHits,
      selectedId,
      darkTheme,
      interactive,
      reducedMotion,
      viewPreferences,
      timelineJourney,
      onNodeClick,
      onHover,
      onViewChange,
      onSourceLod,
      onSelectionClear,
      onExploreMore,
      onAskNode,
      onUserInteraction,
      onTimelineIntent,
      onTimelineSettled,
      onUnavailable,
      text,
    });
    latestRef.current = {
      data,
      policy,
      sourceHits,
      selectedId,
      darkTheme,
      interactive,
      reducedMotion,
      viewPreferences,
      timelineJourney,
      onNodeClick,
      onHover,
      onViewChange,
      onSourceLod,
      onSelectionClear,
      onExploreMore,
      onAskNode,
      onUserInteraction,
      onTimelineIntent,
      onTimelineSettled,
      onUnavailable,
      text,
    };
    const unavailableNotifiedRef = React.useRef(false);
    const notifyUnavailable = React.useCallback((reason: UniverseSceneUnavailableReason) => {
      if (unavailableNotifiedRef.current) return;
      unavailableNotifiedRef.current = true;
      if (hostRef.current) hostRef.current.dataset.universeEngine = reason;
      latestRef.current.onUnavailable?.(reason);
    }, []);

    React.useEffect(() => {
      if (!hostRef.current || !keyboardStatusRef.current) return;
      let cancelled = false;
      const host = hostRef.current;
      const keyboardStatusElement = keyboardStatusRef.current;
      void (async () => {
        let ForceGraph3D: typeof import("3d-force-graph")["default"];
        try {
          ({ default: ForceGraph3D } = await import("3d-force-graph"));
        } catch (reason) {
          console.warn("[KnowledgeUniverse] Failed to load the 3D scene module", reason);
          if (!cancelled) notifyUnavailable("dynamic-import");
          return;
        }
        if (cancelled) return;

        let engine: UniverseForceSceneEngine | null = null;
        try {
          const current = latestRef.current;
          engine = new UniverseForceSceneEngine(
            host,
            current.policy,
            current.viewPreferences,
            current.text,
            keyboardStatusElement,
            ForceGraph3D as unknown as new (
              element: HTMLElement,
              options?: {
                controlType?: "orbit";
                rendererConfig?: THREE.WebGLRendererParameters;
              },
            ) => ForceGraph3DInstance<ForceNode, ForceLink>,
          );
          engineRef.current = engine;
          engine.setCallbacks({
            onNodeClick: current.onNodeClick,
            onHover: current.onHover,
            onViewChange: current.onViewChange,
            onSourceLod: current.onSourceLod,
            onSelectionClear: current.onSelectionClear,
            onExploreMore: current.onExploreMore,
            onAskNode: current.onAskNode,
            onUserInteraction: current.onUserInteraction ?? (() => undefined),
            onTimelineIntent: current.onTimelineIntent,
            onTimelineSettled: current.onTimelineSettled,
            onUnavailable: notifyUnavailable,
          });
          engine.setOptions({
            interactive: current.interactive,
            reducedMotion: current.reducedMotion,
            darkTheme: current.darkTheme,
            viewPreferences: current.viewPreferences,
            timelineJourney: current.timelineJourney,
            text: current.text,
          });
          if (current.interactive) {
            engine.setData(current.data, current.policy, current.sourceHits);
            engine.setSelection(current.selectedId);
            engine.resume();
          }
        } catch (reason) {
          const unavailableReason = classifyUniverseWebGLContextFailure(reason)
            ?? "initialization";
          // A renderer failure is an expected capability boundary, not an
          // uncaught application error. console.error makes the Next dev
          // overlay cover the recoverable fallback UI.
          console.warn(
            `[KnowledgeUniverse] Failed to initialize the 3D scene (${unavailableReason})`,
            reason,
          );
          if (engineRef.current === engine) engineRef.current = null;
          try {
            engine?.dispose();
          } catch (cleanupReason) {
            console.warn("[KnowledgeUniverse] Failed to dispose a partial 3D scene", cleanupReason);
          }
          host.replaceChildren();
          if (!cancelled) notifyUnavailable(unavailableReason);
        }
      })();
      return () => {
        cancelled = true;
        engineRef.current?.dispose();
        engineRef.current = null;
      };
    }, [notifyUnavailable]);

    React.useEffect(() => {
      engineRef.current?.setCallbacks({
        onNodeClick,
        onHover,
        onViewChange,
        onSourceLod,
        onSelectionClear,
        onExploreMore,
        onAskNode,
        onUserInteraction: onUserInteraction ?? (() => undefined),
        onTimelineIntent,
        onTimelineSettled,
        onUnavailable: notifyUnavailable,
      });
    }, [
      notifyUnavailable,
      onAskNode,
      onExploreMore,
      onHover,
      onNodeClick,
      onSelectionClear,
      onSourceLod,
      onTimelineIntent,
      onTimelineSettled,
      onUserInteraction,
      onViewChange,
    ]);

    React.useLayoutEffect(() => {
      engineRef.current?.setOptions({
        interactive,
        reducedMotion,
        darkTheme,
        viewPreferences,
        timelineJourney,
        text,
      });
    }, [
      darkTheme,
      interactive,
      reducedMotion,
      text,
      timelineJourney,
      viewPreferences,
    ]);

    React.useLayoutEffect(() => {
      if (!interactive) return;
      const engine = engineRef.current;
      if (!engine) return;
      engine.setData(data, policy, sourceHits);
      engine.setSelection(latestRef.current.selectedId);
      engine.resume();
    }, [data, interactive, policy, sourceHits]);

    React.useLayoutEffect(() => {
      if (!interactive) return;
      engineRef.current?.setSelection(selectedId);
    }, [interactive, selectedId]);

    React.useImperativeHandle(
      forwardedRef,
      () => ({
        focusOverview: () => engineRef.current?.focusOverview(),
        resetOverview: () => engineRef.current?.resetOverview(),
        focusResult: () => engineRef.current?.focusResult(),
        focusSource: (sourceId) => engineRef.current?.focusSource(sourceId),
        focusNode: (nodeId) => engineRef.current?.focusNode(nodeId),
        lockNode: (nodeId) => engineRef.current?.lockNode(nodeId),
        unlockNode: () => engineRef.current?.unlockNode(),
        clearSelection: () => engineRef.current?.clearSelection(),
        moveTimeline: (direction) => engineRef.current?.moveTimeline(direction),
        pause: () => engineRef.current?.pause(),
        resume: () => engineRef.current?.resume(),
      }),
      [],
    );

    return (
      <>
        <div
          ref={hostRef}
          className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
          data-universe-scene="three"
          data-universe-engine="loading"
          data-universe-active={interactive}
          data-universe-paused={!interactive}
          data-universe-node-count={data.nodes.length}
          data-universe-link-count={data.links.length}
          data-universe-keyboard-active="false"
          data-universe-keyboard-node-id=""
          role="group"
          tabIndex={interactive ? 0 : -1}
          aria-label={text.aria}
          aria-describedby={keyboardInstructionsId}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space Escape"
        />
        <span id={keyboardInstructionsId} className="sr-only">
          {text.keyboardInstructions}
        </span>
        <span
          ref={keyboardStatusRef}
          className="sr-only"
          data-universe-keyboard-status="true"
          aria-live="polite"
          aria-atomic="true"
        />
      </>
    );
  },
);
