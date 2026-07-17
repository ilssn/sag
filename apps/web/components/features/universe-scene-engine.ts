"use client";

import * as THREE from "three";
import { forceCollide } from "d3-force";
import type {
  ForceGraph3DInstance,
  LinkObject,
  NodeObject,
} from "3d-force-graph";

import type { SearchSourceHit, UniversePolicy } from "@/lib/types";
import {
  nextUniverseKeyboardNodeId,
  type UniverseKeyboardDirection,
} from "@/lib/universe-keyboard-navigation";
import {
  type UniverseViewPreferences,
} from "@/lib/universe-view-preferences";
import {
  resolveUniverseDetailSource,
  universeDeepLoadMilestone,
  universeNodeEmergence,
  universeVisualDetailProgress,
  type UniverseNodeEmergence,
} from "@/lib/universe-presentation";
import { planUniverseSceneDelta } from "@/lib/universe-scene-transition";
import {
} from "@/lib/universe-temporal-axis";
import {
  advanceUniverseSourceExitGate,
  applyUniverseTemporalFlightWheel,
  armUniverseSourceExitGate,
  brakeUniverseTemporalFlight,
  createUniverseSourceExitGate,
  createUniverseTemporalFlightState,
  flyUniverseTemporalFlightTo,
  UNIVERSE_FLIGHT_SETTLE_EPSILON,
  type UniverseSourceExitGate,
  type UniverseTemporalFlightState,
} from "@/lib/universe-temporal-flight";
import { UNIVERSE_SCENE_BUDGET } from "@/lib/universe-working-set";
import {
  bindLabelInteraction,
  bindNodeLabelInteraction,
  cancelHoverLabelRebuild,
  hoverLabelOpacityFactor,
  labelFocusId,
  rebuildLabels,
  scheduleHoverLabelRebuild,
  sortLabelsForLayout,
  updateHoverLabelState,
  updateLabels,
} from "@/components/features/universe-scene-labels";
import {
  NEBULA_AMBIENT_MOTION_MS,
  NEBULA_SOURCE_RADIUS_MIN,
  NEBULA_SOURCE_RADIUS_SCALE,
  armNebulaAnimation,
  clearNebula,
  nebulaAmbientEligible,
  nebulaMotionStrength,
  rebuildNebula,
  shouldAnimateNebula,
  stopNebulaAmbientTicker,
  syncNebulaAmbientTicker,
  syncNebulaCorridorUniforms,
  updateNebulaAlphas,
  updateNebulaAnimation,
  updateNebulaMotionState,
  updateNebulaPositions,
} from "@/components/features/universe-scene-nebula";
import {
  updateTemporalFlight,
  updateTemporalPresence,
} from "@/components/features/universe-scene-temporal";
import {
  clearKeyboardFocus,
  keyboardCandidates,
  setKeyboardFocus,
  updateKeyboardStatus,
} from "@/components/features/universe-scene-keyboard";
import {
  updatePointerParallax,
} from "@/components/features/universe-scene-parallax";
import {
  WHITE,
  currentNodePresentationCardScale,
  currentNodePresentationOpacity,
  currentNodePresentationScale,
  presentationOpacity,
  presentationScale,
  stableUnit,
} from "@/components/features/universe-scene-internals";
import {
  makeEntityCoreTexture,
  makeEventCoreTexture,
  makeSpriteTexture,
  NEBULA_GLOW_POINT_SIZE_CSS_DESKTOP,
} from "@/components/features/universe-scene-textures";

export { UNIVERSE_BRAND_GOLD } from "@/components/features/universe-scene-textures";
import type {
  UniverseSceneData,
  UniverseSceneExplorationView,
  UniverseSceneHover,
  UniverseSceneLink,
  UniverseSceneNode,
  UniverseSceneNodeKind,
  UniverseSceneTemporalFlight,
  UniverseSceneUnavailableReason,
  UniverseSceneView,
  UniverseSelectionClearOptions,
  UniverseTimelineDirection,
  UniverseTimelineIntentResult,
  UniverseTimelineJourney,
} from "@/components/features/universe-scene-contract";

export interface UniverseSceneText {
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

export interface ForceNode extends NodeObject {
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
  /** Camera-relative depth scale and opacity, refreshed per frame. */
  temporalPresenceScale?: number;
  temporalPresenceOpacity?: number;
  /** Stable per-node emergence stagger, cached after its first calculation. */
  temporalRevealStart?: number;
  /** Cached hot-path projection of reversible grain → star → whole-card phases. */
  emergence?: UniverseNodeEmergence & { availability: number };
  renderedTemporalPresence?: number;
  renderedDetailFactor?: number;
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

export interface ForceLink extends LinkObject<ForceNode> {
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

export interface NebulaParticle {
  sourceId: string;
  sourceIndex: number;
  offset: THREE.Vector3;
  alpha: number;
  glow: number;
  phase: number;
  twinkle: number;
  core: boolean;
  /** Stays as the camera-relative source beacon while other dust approaches. */
  emitter: boolean;
  radial: number;
}

export interface SceneLabel {
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
  onSourceWheel?: (sourceId: string) => void;
  onSelectionClear: (options?: UniverseSelectionClearOptions) => void;
  onBackRequest?: () => void;
  onBackgroundClick?: () => void;
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
/**
 * A source marker is the colour authority for its nebula. The particle field
 * stores that entry hue and only moves a little toward white for the luminous
 * core. The shader uses it as a secondary tint over the brand-gold overview,
 * then hands the focused source its colour as the camera enters.
 */
const DETAIL_MORPH_RESPONSE_MS = 92;
const DETAIL_MORPH_SETTLE_EPSILON = 0.01;
const HOVER_CLEAR_GRACE_MS = 84;
const MAX_PLACEMENT_MEMORY = 512;
// Keep the focused source luminous while retaining a bounded per-device
// particle budget. Detail gives the selected source most of that budget;
// overview sources keep a proportional share of the same ceiling.
// Inside a source the dust is the medium being explored: slightly brighter
// than the overview, so diving in reads as entering the nebula, not leaving it.
// Keep source nebulae generous in the overview. The source marker is a portal
// into a knowledge cloud, not a pin; a compact minimum avoids three tiny dots
// when a source has a small radius in the manifest.
const NEBULA_SOURCE_FRAME_RATIO = 0.76;
/**
 * Glow pockets are accents, not weather: the brand galaxy is built purely
 * from sharp grains, so oversized haze sprites read as noise smeared over it.
 */
/** Sentinel z far outside any real layout: the loaded band dims nothing. */
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
/** Let the focused core register before it emits the first data window. */
const SOURCE_ENTRY_CORE_HOLD_MS = 140;
const SOURCE_ENTRY_DIVE_KEEP_ALIVE_MS = 1_800;
/** Below this flight speed (units/s) cards are fully expanded. */
/** Above this speed cards stay compact, but never disappear while approaching. */
/** Cards duck quickly when speed picks up and re-expand a beat after settling. */
/** Matches the travelled-package ember floor in universe-temporal-flight. */
/** One restrained filter budget shared by edge and depth-of-field blur. */
/** Corridor lateral spread mirrors the package axis policy. */
/**
 * Most corridor dust becomes the distant canyon walls: pushed far out
 * laterally it barely parallaxes under a gaze turn, so the nebula reads as a
 * vast illuminated surrounding instead of debris sweeping past the camera.
 */
/**
 * Corridor dust is camera-anchored: it repeats modulo this span around the
 * flight depth, so density near the camera is constant no matter whether the
 * source holds 12 events or 5,000. Spreading a fixed budget over the whole
 * axis would dilute a 586-event source to near-invisibility — this is the
 * bounded-window discipline applied to particles.
 */
const NEBULA_GLOW_POINT_SIZE_CSS_MOBILE = 14;
const HIGHLIGHT_FLOW_FRAME_MS = 1000 / 30;
const TIMELINE_WHEEL_LABEL_SELECTOR = "[data-universe-node-id]";
const MINI_WORKSPACE_SELECTOR = "[data-mini-workspace='true']";
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
const TIMELINE_CONDENSE_MS = 680;
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
  // Keep the stable seeded fallback, but let a crowded batch breathe across
  // a few more rings instead of stacking every new node at the source core.
  for (let attempt = 1; attempt <= 64; attempt += 1) {
    const ring = Math.ceil(attempt / 8);
    const distance = ring * (radius * 2 + 12)
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

export class UniverseForceSceneEngine {
  graph: ForceGraph3DInstance<ForceNode, ForceLink>;
  host: HTMLDivElement;
  keyboardStatusElement: HTMLElement;
  private rendererCanvas: HTMLCanvasElement;
  controls: GraphControls;
  private resizeObserver: ResizeObserver;
  policy: UniversePolicy;
  viewPreferences: UniverseViewPreferences;
  callbacks: SceneCallbacks = {
    onNodeClick: () => undefined,
    onHover: () => undefined,
    onViewChange: () => undefined,
    onSourceLod: () => undefined,
    onSourceWheel: () => undefined,
    onSelectionClear: () => undefined,
    onBackRequest: () => undefined,
    onBackgroundClick: () => undefined,
    onExploreMore: () => undefined,
    onAskNode: () => undefined,
    onUserInteraction: () => undefined,
    onTimelineIntent: () => "blocked",
    onTimelineSettled: () => undefined,
    onUnavailable: () => undefined,
  };
  private unavailableNotified = false;
  nodes = new Map<string, ForceNode>();
  /** Stable source lookup shared by layout, LOD and force hot paths. */
  sourceNodesById = new Map<string, ForceNode>();
  sourceNodeList: ForceNode[] = [];
  private placementTargets = new Map<string, THREE.Vector3>();
  private links: ForceLink[] = [];
  private linkStart = new THREE.Vector3();
  private linkEnd = new THREE.Vector3();
  private linkWorldEnd = new THREE.Vector3();
  private projectionCameraRight = new THREE.Vector3();
  private projectionPoint = new THREE.Vector3();
  private projectionEdge = new THREE.Vector3();
  adjacency = new Map<string, Set<string>>();
  private visibleEdgeIds = new Set<string>();
  sourceHits: SearchSourceHit[] = [];
  selectedId: string | null = null;
  lockedId: string | null = null;
  hoveredId: string | null = null;
  hoveredFromLabel = false;
  keyboardFocusedId: string | null = null;
  keyboardActive = false;
  darkTheme = false;
  interactive = true;
  reducedMotion = false;
  paused = true;
  renderingAwake = false;
  private sleepTimer: number | null = null;
  pointerX = 0;
  pointerY = 0;
  pointerActive = false;
  private forwardedTimelineWheelEvents = new WeakSet<Event>();
  flightConfig: UniverseSceneTemporalFlight | null = null;
  flightState: UniverseTemporalFlightState =
    createUniverseTemporalFlightState();
  /** Depth already translated into the camera; deltas compose with orbiting. */
  appliedFlightDepth = 0;
  lastFlightStepAt = 0;
  flightOwnWindowChange = false;
  flightFollowCooldownUntil = 0;
  sourceNavigationPhase:
    | "overview"
    | "origin"
    | "entering"
    | "exploring"
    | "returning" = "overview";
  private sourceExitGate: UniverseSourceExitGate = createUniverseSourceExitGate();
  sourceReturnMotion: {
    sourceId: string;
    startedAt: number;
    duration: number;
    fromDepth: number;
    fromCamera: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toCamera: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;
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
  nebulaPoints: THREE.Points | null = null;
  nebulaParticles: NebulaParticle[] = [];
  nebulaSourceIndices = new Map<string, number>();
  nebulaAlphaKey = "";
  nebulaAlphaUploads = 0;
  lastNebulaAnimationAt = 0;
  nebulaAnimationElapsed = 0;
  nebulaAmbientTimer: number | null = null;
  /** While in the future, the ambient nebula drift holds still (camera gestures). */
  cameraCalmUntil = 0;
  /** Low-passed flight speed in units/s, fed by actual per-frame depth travel. */
  flightSpeed = 0;
  /** 1 = cards fully expanded; eases toward 0 as flight speed rises. */
  flightCardPresence = 1;
  /** True while rotation is clamped to the corridor's forward gaze cone. */
  browseGazeApplied = false;
  /** Applied pointer-parallax lean, in world units along camera right/up. */
  parallaxApplied = { x: 0, y: 0 };
  private browseGazeTimer: number | null = null;
  private sourceEntryTimer: number | null = null;
  private sourceEntryIntent: {
    sourceId: string;
    targetDepth: number;
    stage: "holding" | "emitting";
    remainingMs: number;
    dueAt: number;
  } | null = null;
  sourceSignature = "";
  labelLayer: HTMLDivElement;
  labels: SceneLabel[] = [];
  labelPlacementBudget = { events: 0, entities: 0, total: 0 };
  renderedLabelFocusId: string | null = null;
  hoverLabelTimer: number | null = null;
  hoverLabelFrame: number | null = null;
  private hoverClearTimer: number | null = null;
  rebuildingLabels = false;
  private loopFrame: number | null = null;
  private loopKeepAliveUntil = 0;
  lastLabelAt = 0;
  private lastLodAt = 0;
  private lastVisualLodAt = 0;
  private lastNodeMorphAt = 0;
  private lastControlsChangeAt = 0;
  private latchedDetailSourceId: string | null = null;
  visualSourceId: string | null = null;
  visualDetailMix = 0;
  private visualDetailTarget = 0;
  reportedViewSourceId: string | null = null;
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
  timelineJourney: UniverseTimelineJourney = {
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
  dataReady = false;
  private initialFocusTimer: number | null = null;
  private initialFocusFrame: number | null = null;
  private initialFocusGeneration = 0;
  private resizePending = false;
  private didInitialFocus = false;
  private dataEpoch = 0;
  text: UniverseSceneText;

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
          this.callbacks.onBackgroundClick?.();
          return;
        }
        if (this.timelineIsBusy()) return;
        if (this.hoveredId) this.handleNodeHover(null, false, true);
        this.callbacks.onBackgroundClick?.();
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

  private cancelInitialFocus() {
    this.initialFocusGeneration += 1;
    if (this.initialFocusTimer !== null) {
      window.clearTimeout(this.initialFocusTimer);
      this.initialFocusTimer = null;
    }
    if (this.initialFocusFrame !== null) {
      window.cancelAnimationFrame(this.initialFocusFrame);
      this.initialFocusFrame = null;
    }
  }

  private scheduleInitialFocus() {
    if (
      this.didInitialFocus
      || !this.dataReady
      || !this.interactive
      || this.paused
    ) return;
    this.cancelInitialFocus();
    const generation = this.initialFocusGeneration;
    this.initialFocusTimer = window.setTimeout(() => {
      this.initialFocusTimer = null;
      if (
        generation !== this.initialFocusGeneration
        || this.didInitialFocus
        || !this.interactive
        || this.paused
      ) return;
      this.initialFocusFrame = window.requestAnimationFrame(() => {
        this.initialFocusFrame = null;
        if (
          generation !== this.initialFocusGeneration
          || this.didInitialFocus
          || !this.interactive
          || this.paused
        ) return;
        this.didInitialFocus = true;
        const sourceId = this.flightConfig?.sourceId
          ?? this.sourceHits[0]?.source_id;
        if (sourceId) this.focusSource(sourceId);
        else this.focusOverview();
      });
    }, 48);
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
    const previousFlight = this.flightConfig;
    const flightSourceChanged = nextFlight?.sourceId !== previousFlight?.sourceId;
    if (previousFlight && flightSourceChanged) this.stopCameraMotion();
    this.flightConfig = nextFlight;
    // The gaze cone belongs to one corridor: leaving or switching sources
    // frees the camera immediately; the next entry dive re-applies it.
    if (!nextFlight || flightSourceChanged) {
      this.releaseBrowseGaze();
      this.cancelSourceEntryDive();
      this.sourceReturnMotion = null;
    }
    if (!nextFlight) {
      this.sourceNavigationPhase = "overview";
      this.host.dataset.universeSourceNavigation = "overview";
      this.sourceExitGate = createUniverseSourceExitGate();
    }
    if (nextFlight && flightSourceChanged) {
      // A fresh browse session starts outside the first package band. Depth 0
      // is the canonical source hero: intact nebula, no cards, ready to dive.
      this.flightState = createUniverseTemporalFlightState(0);
      this.appliedFlightDepth = this.flightState.depth;
      this.flightOwnWindowChange = false;
      this.markSourceOrigin();
    } else if (
      nextFlight
      && windowChanged
      && !this.flightOwnWindowChange
      && this.sourceNavigationPhase !== "origin"
      && this.sourceNavigationPhase !== "returning"
    ) {
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
      if (nextFlight) this.markSourceOrigin();
      else {
        this.sourceNavigationPhase = "overview";
        this.host.dataset.universeSourceNavigation = "overview";
        this.sourceExitGate = createUniverseSourceExitGate();
      }
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
        // Birth size belongs exclusively to nodeEmergence(). Timeline motion
        // owns position and opacity; a second scale curve caused stars to grow
        // twice and made reverse paging visibly pulse.
        scaleFrom: 1,
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
      const currentScale = 1;
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
        // Emergence owns the reversible star size in both directions.
        scaleFrom: 1,
        scaleTo: 1,
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
    this.rebuildSourceNodeIndex();
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
    this.cancelInitialFocus();
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
    if (!this.paused && nextFlight && flightSourceChanged) {
      this.didInitialFocus = true;
      this.focusSource(nextFlight.sourceId);
    } else if (!this.paused && searchFocusSourceId && !this.lockedId) {
      this.didInitialFocus = true;
      this.focusSource(searchFocusSourceId);
    } else {
      this.scheduleInitialFocus();
    }
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

  private rebuildSourceNodeIndex() {
    this.sourceNodesById.clear();
    this.sourceNodeList = [];
    this.nodes.forEach((node) => {
      if (node.kind !== "source") return;
      this.sourceNodesById.set(node.sourceId, node);
      this.sourceNodeList.push(node);
    });
  }

  focusOverview() {
    this.frameOverview(760, false);
  }

  captureExplorationView(): UniverseSceneExplorationView | null {
    const camera = this.graph.camera();
    const target = this.controls.target;
    if (
      !target
      || ![camera.position.x, camera.position.y, camera.position.z,
        target.x, target.y, target.z].every(Number.isFinite)
    ) return null;
    return {
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      target: { x: target.x, y: target.y, z: target.z },
      sourceId: this.visualSourceId ?? this.latchedDetailSourceId,
      detailMix: THREE.MathUtils.clamp(this.visualDetailMix, 0, 1),
      flightDepth: Math.max(0, this.appliedFlightDepth),
    };
  }

  restoreExplorationView(view: UniverseSceneExplorationView) {
    this.cancelTimelineTransition(true);
    this.pointerActive = false;
    this.visualSourceId = view.sourceId;
    this.latchedDetailSourceId = view.sourceId;
    this.requestedSourceId = view.sourceId;
    this.reportedViewSourceId = view.sourceId;
    this.overviewRequested = view.sourceId === null;
    this.visualDetailMix = THREE.MathUtils.clamp(view.detailMix, 0, 1);
    this.visualDetailTarget = this.visualDetailMix;
    if (this.flightConfig && view.sourceId === this.flightConfig.sourceId) {
      const depth = THREE.MathUtils.clamp(
        view.flightDepth,
        0,
        this.flightConfig.maxDepth,
      );
      this.flightState = createUniverseTemporalFlightState(depth);
      this.appliedFlightDepth = depth;
      this.updateTemporalPresence();
      this.applyBrowseGaze();
      if (depth <= UNIVERSE_FLIGHT_SETTLE_EPSILON) this.markSourceOrigin();
      else this.markSourceExploring();
    }
    this.host.dataset.universeVisualMode = view.sourceId ? "detail" : "overview";
    this.host.dataset.universeDetailSource = view.sourceId ?? "";
    this.host.dataset.universeDetailLatched = view.sourceId ?? "";
    this.host.dataset.universeDetailMix = this.visualDetailMix.toFixed(2);
    this.host.dataset.universeDetailTarget = this.visualDetailTarget.toFixed(2);
    const duration = this.reducedMotion ? 0 : 420;
    this.graph.cameraPosition(view.camera, view.target, duration);
    this.updateVisualLayout(performance.now(), true, false);
    this.rebuildLabels();
    this.applyHighlight();
    this.wakeRendering(duration + 500);
    this.startLoop(duration + 180);
    this.callbacks.onViewChange({
      mode: view.sourceId ? "detail" : "overview",
      sourceId: view.sourceId,
      progress: this.visualDetailMix,
    });
  }

  /**
   * Clears transient exploration presentation without discarding the loaded
   * working set. The canonical, zero-duration camera move is important when
   * the workspace covers the universe: the renderer can then sleep on a
   * deterministic overview frame instead of preserving an off-screen orbit.
   */
  resetOverview() {
    this.cancelTimelineTransition(true);
    this.cancelSourceEntryDive();
    this.releaseBrowseGaze();
    this.parallaxApplied = { x: 0, y: 0 };
    this.flightState = brakeUniverseTemporalFlight(this.flightState);
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
    this.sourceReturnMotion = null;
    this.sourceNavigationPhase = "overview";
    this.host.dataset.universeSourceNavigation = "overview";
    this.host.dataset.universeSourceEntry = "";
    this.sourceExitGate = createUniverseSourceExitGate();
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
    const sources = this.sourceNodeList;
    if (!sources.length) return;
    const bounds = new THREE.Box3();
    sources.forEach((node) => {
      const radius = Math.max(
        NEBULA_SOURCE_RADIUS_MIN,
        node.sceneNode.radius * NEBULA_SOURCE_RADIUS_SCALE,
      ) * NEBULA_SOURCE_FRAME_RATIO;
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
      const radius = Math.max(
        NEBULA_SOURCE_RADIUS_MIN,
        node.sceneNode.radius * NEBULA_SOURCE_RADIUS_SCALE,
      ) * NEBULA_SOURCE_FRAME_RATIO;
      const depthOffset = node.z - center.z;
      const extent = Math.abs(node.y - center.y) + radius;
      return depthOffset + extent / Math.max(0.01, halfFov);
    }));
    const distanceX = Math.max(...sources.map((node) => {
      const radius = Math.max(
        NEBULA_SOURCE_RADIUS_MIN,
        node.sceneNode.radius * NEBULA_SOURCE_RADIUS_SCALE,
      ) * NEBULA_SOURCE_FRAME_RATIO;
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

  private sourceHeroPose(node: ForceNode, depth: number) {
    const flight = this.flightConfig;
    if (!flight || flight.sourceId !== node.sourceId) return null;
    const entryZ = flight.centerZ - depth;
    const nebulaRadius = Math.max(
      NEBULA_SOURCE_RADIUS_MIN,
      node.sceneNode.radius * NEBULA_SOURCE_RADIUS_SCALE,
    );
    const heroStandoff = Math.min(
      860,
      Math.max(CORRIDOR_ENTRY_STANDOFF, nebulaRadius * 3.45),
    );
    return {
      target: new THREE.Vector3(
        node.x + CORRIDOR_ENTRY_LATERAL_X * 0.35,
        node.y + CORRIDOR_ENTRY_LATERAL_Y * 0.35,
        entryZ - CORRIDOR_ENTRY_LOOK_AHEAD,
      ),
      camera: new THREE.Vector3(
        node.x + CORRIDOR_ENTRY_LATERAL_X,
        node.y + CORRIDOR_ENTRY_LATERAL_Y,
        entryZ + heroStandoff,
      ),
    };
  }

  private stopCameraMotion() {
    const camera = this.graph.camera().position;
    const target = this.controls.target ?? new THREE.Vector3();
    // cameraPosition(..., 0) replaces the force-graph tween with its current
    // pose. Source switches and back navigation must never keep flying toward
    // a source whose data is no longer authoritative.
    this.graph.cameraPosition(
      { x: camera.x, y: camera.y, z: camera.z },
      { x: target.x, y: target.y, z: target.z },
      0,
    );
  }

  markSourceOrigin(now = performance.now()) {
    this.cancelSourceEntryDive();
    this.sourceNavigationPhase = "origin";
    this.host.dataset.universeSourceNavigation = "origin";
    this.host.dataset.universeSourceEntry = "core";
    this.sourceExitGate = armUniverseSourceExitGate(now);
  }

  private cancelSourceEntryDive() {
    if (this.sourceEntryTimer !== null) {
      window.clearTimeout(this.sourceEntryTimer);
      this.sourceEntryTimer = null;
    }
    this.sourceEntryIntent = null;
  }

  private beginSourceEntryDive(sourceId: string, targetDepth: number) {
    if (
      this.paused
      || this.flightConfig?.sourceId !== sourceId
      || this.sourceNavigationPhase !== "entering"
    ) return;
    if (this.sourceEntryTimer !== null) window.clearTimeout(this.sourceEntryTimer);
    this.sourceEntryTimer = null;
    this.sourceEntryIntent = {
      sourceId,
      targetDepth,
      stage: "emitting",
      remainingMs: 0,
      dueAt: performance.now(),
    };
    this.host.dataset.universeSourceEntry = "emitting";
    this.flightState = flyUniverseTemporalFlightTo(this.flightState, targetDepth);
    this.lastFlightStepAt = performance.now();
    this.wakeRendering(SOURCE_ENTRY_DIVE_KEEP_ALIVE_MS);
    this.startLoop(SOURCE_ENTRY_DIVE_KEEP_ALIVE_MS);
  }

  private scheduleSourceEntryDive(
    sourceId: string,
    targetDepth: number,
    delayMs: number,
  ) {
    if (this.sourceEntryTimer !== null) window.clearTimeout(this.sourceEntryTimer);
    const remainingMs = Math.max(0, delayMs);
    this.sourceNavigationPhase = "entering";
    this.host.dataset.universeSourceNavigation = "entering";
    this.sourceEntryIntent = {
      sourceId,
      targetDepth,
      stage: "holding",
      remainingMs,
      dueAt: performance.now() + remainingMs,
    };
    this.sourceEntryTimer = window.setTimeout(() => {
      this.beginSourceEntryDive(sourceId, targetDepth);
    }, remainingMs);
  }

  private suspendSourceEntryDive() {
    const intent = this.sourceEntryIntent;
    if (!intent) return;
    if (intent.stage === "holding") {
      intent.remainingMs = Math.max(0, intent.dueAt - performance.now());
    }
    if (this.sourceEntryTimer !== null) {
      window.clearTimeout(this.sourceEntryTimer);
      this.sourceEntryTimer = null;
    }
  }

  private resumeSourceEntryDive() {
    const intent = this.sourceEntryIntent;
    if (!intent || this.flightConfig?.sourceId !== intent.sourceId) return;
    this.sourceNavigationPhase = "entering";
    this.host.dataset.universeSourceNavigation = "entering";
    if (intent.stage === "emitting") {
      this.host.dataset.universeSourceEntry = "emitting";
      this.flightState = flyUniverseTemporalFlightTo(
        this.flightState,
        intent.targetDepth,
      );
      this.lastFlightStepAt = performance.now();
      return;
    }
    const node = this.sourceNodesById.get(intent.sourceId);
    const pose = node ? this.sourceHeroPose(node, 0) : null;
    const cameraDuration = Math.max(
      0,
      intent.remainingMs - SOURCE_ENTRY_CORE_HOLD_MS,
    );
    if (pose && cameraDuration > 0) {
      this.graph.cameraPosition(
        { x: pose.camera.x, y: pose.camera.y, z: pose.camera.z },
        { x: pose.target.x, y: pose.target.y, z: pose.target.z },
        cameraDuration,
      );
    }
    this.scheduleSourceEntryDive(
      intent.sourceId,
      intent.targetDepth,
      intent.remainingMs,
    );
  }

  markSourceExploring() {
    if (!this.flightConfig) return;
    this.cancelSourceEntryDive();
    this.sourceReturnMotion = null;
    this.sourceExitGate = createUniverseSourceExitGate();
    this.sourceNavigationPhase = "exploring";
    this.host.dataset.universeSourceNavigation = "exploring";
  }

  returnToSourceOrigin(sourceId: string): "moved" | "already-at-origin" {
    const node = this.sourceNodesById.get(sourceId);
    const pose = node ? this.sourceHeroPose(node, 0) : null;
    if (!node || !pose || this.flightConfig?.sourceId !== sourceId) {
      return "already-at-origin";
    }
    if (this.sourceNavigationPhase === "origin" && !this.sourceReturnMotion) {
      return "already-at-origin";
    }
    if (this.sourceNavigationPhase === "returning" && this.sourceReturnMotion) {
      return "moved";
    }

    this.cancelTimelineTransition(true);
    this.cancelSourceEntryDive();
    this.stopCameraMotion();
    this.clearSelection();
    this.releaseBrowseGaze();
    if (this.browseGazeTimer !== null) window.clearTimeout(this.browseGazeTimer);
    this.browseGazeTimer = null;
    this.pointerActive = false;
    this.parallaxApplied = { x: 0, y: 0 };
    this.flightState = brakeUniverseTemporalFlight(this.flightState);
    const now = performance.now();
    const duration = this.reducedMotion ? 0 : 760;
    this.sourceReturnMotion = {
      sourceId,
      startedAt: now,
      duration,
      fromDepth: this.appliedFlightDepth,
      fromCamera: this.graph.camera().position.clone(),
      fromTarget: this.controls.target?.clone() ?? pose.target.clone(),
      toCamera: pose.camera,
      toTarget: pose.target,
    };
    this.sourceNavigationPhase = "returning";
    this.host.dataset.universeSourceNavigation = "returning";
    this.host.dataset.universeCameraTarget = `source-origin:${sourceId}`;
    this.wakeRendering(duration + 560);
    if (duration === 0) this.updateSourceReturnMotion(now);
    else this.startLoop(duration + 180);
    return "moved";
  }

  updateSourceReturnMotion(now: number) {
    const motion = this.sourceReturnMotion;
    if (!motion) return false;
    const progress = motion.duration <= 0
      ? 1
      : THREE.MathUtils.clamp((now - motion.startedAt) / motion.duration, 0, 1);
    const eased = easeTimelineMotion(progress);
    const depth = THREE.MathUtils.lerp(motion.fromDepth, 0, eased);
    this.appliedFlightDepth = depth;
    this.flightState = createUniverseTemporalFlightState(depth);
    this.graph.camera().position.lerpVectors(motion.fromCamera, motion.toCamera, eased);
    this.controls.target?.lerpVectors(motion.fromTarget, motion.toTarget, eased);
    this.syncNebulaCorridorUniforms();
    this.updateTemporalPresence();
    this.updateVisualLayout(now);
    this.updateNodeMorphScales(now);
    this.updateLabels(now);
    this.host.dataset.universeFlightDepth = depth.toFixed(1);
    if (progress < 1) return true;

    this.sourceReturnMotion = null;
    this.markSourceOrigin(now);
    this.host.dataset.universeFlightVelocity = "0.0";
    this.applyBrowseGaze();
    return false;
  }

  focusSource(sourceId: string) {
    const node = this.sourceNodesById.get(sourceId);
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
    // One entry choreography owns the source: approach a compact bright core,
    // hold it for a beat, then let that same core emit the first loaded window.
    // No second focus call and no separate particle explosion are involved.
    const flight = this.flightConfig;
    if (flight && flight.sourceId === sourceId) {
      if (this.sourceNavigationPhase === "overview") {
        this.flightState = createUniverseTemporalFlightState(0);
        this.appliedFlightDepth = 0;
        this.markSourceOrigin();
      }
      const shouldAutoEnter = this.sourceNavigationPhase === "origin"
        && this.appliedFlightDepth <= UNIVERSE_FLIGHT_SETTLE_EPSILON
        && this.sourceEntryIntent === null;
      const firstDataDepth = THREE.MathUtils.clamp(
        Math.max(flight.vestibuleDepth, flight.windowNearDepth),
        0,
        flight.maxDepth,
      );
      const arrivalDepth = shouldAutoEnter && this.reducedMotion
        ? firstDataDepth
        : this.appliedFlightDepth;
      const pose = this.sourceHeroPose(node, arrivalDepth);
      if (!pose) return;
      const { camera: position, target: lookAt } = pose;
      this.pointerActive = false;
      this.lodArmed = false;
      if (this.hoveredId) this.handleNodeHover(null, false, true);
      const duration = this.reducedMotion ? 0 : CORRIDOR_ENTRY_MS;
      this.wakeRendering(duration + SOURCE_ENTRY_DIVE_KEEP_ALIVE_MS);
      this.host.dataset.universeSourceEntryTargetDepth = firstDataDepth.toFixed(1);
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
      if (shouldAutoEnter) {
        if (this.reducedMotion) {
          this.appliedFlightDepth = firstDataDepth;
          this.flightState = createUniverseTemporalFlightState(firstDataDepth);
          this.markSourceExploring();
          this.host.dataset.universeSourceEntry = "ready";
          this.syncNebulaCorridorUniforms();
          this.updateTemporalPresence();
          this.updateNodeMorphScales(performance.now(), true);
          this.updateLabels(performance.now());
        } else {
          this.scheduleSourceEntryDive(
            sourceId,
            firstDataDepth,
            duration + SOURCE_ENTRY_CORE_HOLD_MS,
          );
        }
      }
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
      this.markSourceExploring();
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
    // Visibility suspension is not a user cancellation. Preserve the source
    // entry intent so returning to the tab continues the same core-to-data
    // handoff instead of stranding the camera at an arbitrary half-depth.
    this.suspendSourceEntryDive();
    this.keyboardActive = false;
    this.host.dataset.universeKeyboardActive = "false";
    this.clearKeyboardFocus(false, false);
    this.cancelHoverClear();
    this.cancelHoverLabelRebuild();
    this.loopKeepAliveUntil = 0;
    this.stopNebulaAmbientTicker();
    this.host.dataset.universeLoop = "idle";
    this.host.dataset.universeNebulaMotion = "idle";
    this.host.dataset.universePaused = "true";
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    this.cancelInitialFocus();
    this.sleepTimer = null;
    this.lodTimer = null;
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
    this.resumeSourceEntryDive();
    this.scheduleInitialFocus();
    this.wakeRendering(1200);
    this.startLoop(120);
    this.armNebulaAnimation();
  }

  dispose() {
    this.cancelTimelineTransition(true);
    this.cancelSourceEntryDive();
    this.pause();
    this.cancelHoverLabelRebuild();
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    this.cancelInitialFocus();
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
    this.sourceNodesById.clear();
    this.sourceNodeList = [];
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
      this.clusterNodes.forEach((node) => {
        if (node.kind === "source") return;
        const source = this.sourceNodesById.get(node.sourceId);
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

  timelineIsBusy() {
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

    this.markSourceExploring();

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
      halo.userData.baseVisualScale = haloSize;
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
      sprite.userData.baseVisualScale = coreSize;
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
      halo.userData.baseVisualScale = haloSize;
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
      sprite.userData.baseVisualScale = coreSize;
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
      aura.scale.set(size * 2.15, size * 2.15, size * 2.15);
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

  /**
   * Focus used by the label layout. Pointer hover is deliberately excluded:
   * moving across a card should highlight the relationship, not rebuild the
   * collision layout underneath the pointer. Click/keyboard focus remains a
   * committed layout change and is allowed to reveal its one-hop network.
   */
  private labelFocusId() {
    return labelFocusId(this);
  }
  private interactionFocusId() {
    const focusId = this.lockedId
      ?? this.selectedId
      ?? this.keyboardFocusedId
      ?? (this.visualDetailMix >= 0.5 ? this.hoveredId : null);
    return focusId && this.nodes.get(focusId)?.kind !== "source" ? focusId : null;
  }

  transientHoverFocusId() {
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
    return cancelHoverLabelRebuild(this);
  }

  cancelHoverClear() {
    if (this.hoverClearTimer !== null) window.clearTimeout(this.hoverClearTimer);
    this.hoverClearTimer = null;
  }

  scheduleHoverLabelRebuild(immediate = false) {
    return scheduleHoverLabelRebuild(this, immediate);
  }

  handleNodeHover(
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
    if (nextId === this.hoveredId) {
      // A pointer can leave the DOM card and enter its WebGL star without
      // changing the node id. Keep the hover alive and hand ownership back to
      // the canvas instead of scheduling a false clear between the two layers.
      if (node && !fromLabel) this.hoveredFromLabel = false;
      return;
    }
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

  applyHighlight() {
    const anchorId = this.interactionFocusId();
    const layoutFocusId = this.labelFocusId();
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
      // Hover is a transient relationship preview: keep the current node and
      // its one-hop neighbors readable, while the unrelated field recedes.
      // The same hierarchy is used for a persistent click focus, only with a
      // slightly stronger context mute.
      if (anchorId) {
        if (node.id === anchorId) opacity = 1;
        else if (neighbors?.has(node.id)) opacity = transientHover ? 0.76 : 0.92;
        else if (node.kind === "source" && anchor?.sourceId === node.sourceId) {
          opacity = transientHover ? 0.28 : 0.38;
        } else opacity = transientHover ? 0.12 : 0.18;
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
          && label.nodeId === layoutFocusId
          && !transientHover,
      );
    });
    this.host.dataset.universeRenderedRelations = String(this.visibleEdgeIds.size);
    this.host.dataset.universeHighlightedRelations = String(relationCount);
    this.host.dataset.universeRelationAnchor = anchorId ?? "";
    this.updateNebulaAlphas();
    this.updateLinkVisuals();
    this.syncHighlightFlowSprites();
    // Highlighting is paint-only unless the committed layout focus changed.
    // Re-running the greedy placement pass for a pointer hover used to move
    // cards under the pointer, which caused pointerleave/pointerenter loops
    // and visible flicker. Persistent focus still gets a normal rebuild.
    if (layoutFocusId !== this.renderedLabelFocusId) {
      this.rebuildLabels();
    } else {
      this.updateHoverLabelState();
    }
    this.renderOnce();
  }

  private updateHoverLabelState() {
    return updateHoverLabelState(this);
  }

  private hoverLabelOpacityFactor(node: ForceNode) {
    return hoverLabelOpacityFactor(this, node);
  }

  private updateObjectOpacities() {
    this.applyHighlight();
  }

  /**
   * One reversible availability curve drives every concrete-node entrance:
   * initial source dive, incremental expansion, timeline paging and the same
   * motions in reverse. The halo is the last grains gathering; the core star
   * resolves next; then one complete DOM card grows with no internal staging.
   */
  nodeEmergence(node: ForceNode) {
    const motionAvailability = THREE.MathUtils.clamp(
      (node.entryOpacity ?? 1) * (node.timelineOpacity ?? 1),
      0,
      1,
    );
    const availability = node.kind === "source"
      ? motionAvailability
      : Math.min(
          motionAvailability,
          THREE.MathUtils.clamp(
            node.temporalPresenceOpacity ?? 1,
            0,
            1,
          ),
        );
    const cached = node.emergence;
    if (cached && Math.abs(cached.availability - availability) < 0.001) {
      return cached;
    }
    if (node.kind === "source") {
      const sourceState = cached ?? {
        availability: 0,
        grain: 0,
        star: 0,
        card: 0,
        cloudScale: 0.28,
        starScale: 0.28,
        cardScale: 1,
        blur: 0,
      };
      sourceState.availability = availability;
      sourceState.grain = availability;
      sourceState.star = availability;
      sourceState.card = availability;
      sourceState.starScale = 0.28 + easeOutCubic(availability) * 0.72;
      sourceState.cloudScale = sourceState.starScale;
      sourceState.cardScale = 1;
      sourceState.blur = 0;
      node.emergence = sourceState;
      return sourceState;
    }
    const motionGroupId = node.sceneNode.timelineBundleId ?? node.id;
    const stagger = node.temporalRevealStart ??= (
      stableUnit(`${motionGroupId}:emergence`) * 0.72
      + stableUnit(`${node.id}:emergence-detail`) * 0.28
    );
    const next = cached ?? {
      availability,
      grain: 0,
      star: 0,
      card: 0,
      cloudScale: 0.22,
      starScale: 0.08,
      cardScale: 0.36,
      blur: 7,
    };
    universeNodeEmergence(availability, node.kind, stagger, next);
    next.availability = availability;
    node.emergence = next;
    return next;
  }

  setObjectOpacity(node: ForceNode, opacity: number, emphasized: boolean) {
    const entryOpacity = (node.entryOpacity ?? 1) * (node.timelineOpacity ?? 1);
    const emergence = this.nodeEmergence(node);
    const dataScale = currentNodePresentationScale(node);
    const dataOpacity = currentNodePresentationOpacity(node);
    const presenceScale = node.temporalPresenceScale ?? 1;
    const atmosphereOpacity = this.nodeAtmosphereOpacity(node);
    const presenceKey = presenceScale * 4096
      + (node.temporalPresenceOpacity ?? 1) * 64
      + emergence.star * 8
      + emergence.grain;
    const entityDetail = node.kind === "entity"
      && node.sourceId === this.visualSourceId
      && !emphasized
      ? THREE.MathUtils.smoothstep(this.visualDetailMix, 0.42, 0.82)
      : 0;
    if (
      node.visualOpacity === opacity
      && node.visuallyEmphasized === emphasized
      && node.renderedEntryOpacity === entryOpacity
      && node.renderedPresentationScale === dataScale
      && node.renderedPresentationOpacity === dataOpacity
      && node.renderedTemporalPresence === presenceKey
      && node.renderedDetailFactor === entityDetail
    ) return;
    node.visualOpacity = opacity;
    node.visuallyEmphasized = emphasized;
    node.renderedEntryOpacity = entryOpacity;
    node.renderedPresentationScale = dataScale;
    node.renderedPresentationOpacity = dataOpacity;
    node.renderedTemporalPresence = presenceKey;
    node.renderedDetailFactor = entityDetail;
    const object = node.object;
    if (!object) return;
    const entryScale = emergence.cloudScale;
    // A transient hover is a glance, not a commitment: the network answers
    // with a whisper of scale. Only a locked focus earns the firm pop —
    // reading is the point, and jumping stars under the cursor break it.
    const emphasisScale = emphasized
      ? node.id === this.transientHoverFocusId() ? 1 : 1.12
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
          child.visible = emergence.star >= 0.72
            && emergence.star * dataOpacity * atmosphereOpacity > 0.16;
        }
        return;
      }
      const haloStage = Boolean(
        child.userData.eventHalo || child.userData.entityHalo,
      );
      const emergenceOpacity = node.kind === "source"
        ? emergence.star
        : haloStage ? emergence.grain : emergence.star;
      let detailOpacity = 1;
      let detailScale = 1;
      if (node.kind === "entity" && entityDetail > 0) {
        const root = node.sceneNode.root;
        const isHalo = Boolean(child.userData.entityHalo);
        const targetOpacity = isHalo
          ? root ? 0.52 : 0.36
          : root ? 0.82 : 0.7;
        const targetScale = isHalo
          ? root ? 0.65 : 0.58
          : root ? 0.78 : 0.72;
        detailOpacity = THREE.MathUtils.lerp(1, targetOpacity, entityDetail);
        detailScale = THREE.MathUtils.lerp(1, targetScale, entityDetail);
      }
      const baseVisualScale = child.userData.baseVisualScale;
      if (typeof baseVisualScale === "number") {
        const coreStageScale = node.kind !== "source"
          && !haloStage
          ? emergence.starScale / Math.max(0.001, emergence.cloudScale)
          : 1;
        child.scale.setScalar(baseVisualScale * detailScale * coreStageScale);
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
        material.opacity = emergenceOpacity <= 0.001
          ? 0
          : Math.max(
              child.userData.sourceAura
                ? 0
                : 0.035 * emergenceOpacity * dataOpacity
                  * atmosphereOpacity,
              base * opacity * emergenceOpacity * detailFactor
                * detailOpacity * dataOpacity * atmosphereOpacity,
            );
      });
    });
  }

  nodeAtmosphereOpacity(node: ForceNode) {
    if (node.kind === "source") return 1;
    return THREE.MathUtils.lerp(
      0.62,
      1,
      THREE.MathUtils.clamp(node.temporalPresenceOpacity ?? 1, 0, 1),
    );
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
    const projectionScale = this.flightConfig?.sourceId === node.sourceId
      ? 1
      : this.nodeProjectionScale(node);
    return (0.82 + easeOutCubic(progress) * 0.18) * projectionScale;
  }

  private sourceMarkerDetailFactor(node: ForceNode, child: THREE.Object3D) {
    const selectedSource = node.sourceId === this.visualSourceId;
    const focus = selectedSource
      ? THREE.MathUtils.smoothstep(this.visualDetailMix, 0.18, 0.78)
      : 0;
    const config = this.flightConfig;
    const dive = selectedSource && config?.sourceId === node.sourceId
      && config.vestibuleDepth > 0
      ? THREE.MathUtils.smoothstep(
          this.appliedFlightDepth,
          0,
          config.vestibuleDepth * 0.9,
        )
      : 0;
    if (child.userData.sourceAura) {
      return selectedSource
        ? THREE.MathUtils.lerp(1, 0.42, focus)
          * THREE.MathUtils.lerp(1, 0.72, dive)
        : Math.max(0.04, 1 - this.visualDetailMix * 0.96);
    }
    if (child.userData.sourceCore) {
      return selectedSource
        ? THREE.MathUtils.lerp(1, 0.3, dive)
        : Math.max(0.03, 1 - this.visualDetailMix * 1.02);
    }
    return 1;
  }

  // Projection scale tracks camera distance, so a dolly dirties every node, and
  // OrbitControls emits change synchronously without rAF coalescing. Throttling to
  // the visual-refresh cadence is safe for animating nodes: setObjectOpacity
  // applies the same formula every frame while a timelineMotion is in flight.
  updateNodeMorphScales(now = performance.now(), force = false) {
    const elapsed = this.lastNodeMorphAt > 0
      ? Math.max(1, now - this.lastNodeMorphAt)
      : 32;
    if (!force && elapsed < 24) return;
    this.lastNodeMorphAt = now;
    this.nodes.forEach((node) => {
      if (!node.object) return;
      const emergence = this.nodeEmergence(node);
      const entryScale = emergence.cloudScale;
      const dataScale = currentNodePresentationScale(node);
      const emphasisScale = node.visuallyEmphasized
        ? node.id === this.transientHoverFocusId() ? 1 : 1.12
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
    return rebuildNebula(this);
  }
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
  syncNebulaCorridorUniforms() {
    return syncNebulaCorridorUniforms(this);
  }

  private updateNebulaPositions() {
    return updateNebulaPositions(this);
  }

  private updateNebulaAlphas(force = false) {
    return updateNebulaAlphas(this, force);
  }

  private nebulaMotionStrength() {
    return nebulaMotionStrength(this);
  }

  private nebulaAmbientEligible() {
    return nebulaAmbientEligible(this);
  }

  private shouldAnimateNebula() {
    return shouldAnimateNebula(this);
  }

  private stopNebulaAmbientTicker() {
    return stopNebulaAmbientTicker(this);
  }

  private syncNebulaAmbientTicker() {
    return syncNebulaAmbientTicker(this);
  }

  private armNebulaAnimation(duration = NEBULA_AMBIENT_MOTION_MS) {
    return armNebulaAnimation(this, duration);
  }

  private updateNebulaMotionState() {
    return updateNebulaMotionState(this);
  }

  private updateNebulaAnimation(now: number) {
    return updateNebulaAnimation(this, now);
  }

  private clearNebula() {
    return clearNebula(this);
  }

  sourceVisualColor(sourceId: string) {
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
    // A relation is only as mature as its dimmer endpoint. Consuming the same
    // star phase prevents a line from drawing through empty space before its
    // two condensed stars exist.
    const presenceOpacity = Math.min(
      (source ? this.nodeEmergence(source).star : 1)
        * (source ? this.nodeAtmosphereOpacity(source) : 1),
      (target ? this.nodeEmergence(target).star : 1)
        * (target ? this.nodeAtmosphereOpacity(target) : 1),
    );
    const timelineOpacity = dataOpacity * presenceOpacity;
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

  updateLinkVisuals() {
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
    return rebuildLabels(this);
  }

  private sortLabelsForLayout() {
    return sortLabelsForLayout(this);
  }

  private bindLabelInteraction(element: HTMLButtonElement, node: ForceNode) {
    return bindLabelInteraction(this, element, node);
  }

  private bindNodeLabelInteraction(
    container: HTMLElement,
    primary: HTMLButtonElement,
    actionButtons: HTMLButtonElement[],
    node: ForceNode,
  ) {
    return bindNodeLabelInteraction(this, container, primary, actionButtons, node);
  }

  updateLabels(now: number, force = false) {
    return updateLabels(this, now, force);
  }

  miniPanelRect(hostRect?: DOMRectReadOnly) {
    return this.relativeOverlayRect("[data-mini-workspace='true']", 10, hostRect);
  }

  relativeOverlayRect(
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
    const panels = [this.miniPanelRect()]
      .filter((panel): panel is NonNullable<typeof panel> => panel !== null);
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
    const edge = this.projectionEdge.set(node.x, node.y, node.z).addScaledVector(
      cameraRight,
      node.sceneNode.radius,
    );
    const projectedEdge = this.graph.graph2ScreenCoords(edge.x, edge.y, edge.z);
    const radiusPx = Math.hypot(projectedEdge.x - center.x, projectedEdge.y - center.y);
    return Number.isFinite(radiusPx) ? radiusPx : null;
  }

  updateVisualLayout(now: number, force = false, refresh = true) {
    const elapsed = this.lastVisualLodAt > 0
      ? Math.max(1, now - this.lastVisualLodAt)
      : 32;
    if (!force && elapsed < 24) return;
    this.lastVisualLodAt = now;
    const camera = this.graph.camera();
    camera.updateMatrixWorld();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const cameraRight = this.projectionCameraRight
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();
    let best: {
      node: ForceNode;
      radiusPx: number;
      score: number;
    } | null = null;
    this.sourceNodeList.forEach((node) => {
      const center = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
      const projectedDepth = this.projectionPoint
        .set(node.x, node.y, node.z)
        .project(camera)
        .z;
      const radiusPx = this.projectedSourceRadius(node, cameraRight);
      if (radiusPx === null) return;
      const distancePx = Math.hypot(center.x - width / 2, center.y - height / 2);
      const inFrame = projectedDepth > -1
        && projectedDepth < 1
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
      ? this.sourceNodesById.get(this.visualSourceId)
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
      ? this.sourceNodesById.get(this.latchedDetailSourceId)
      : undefined;
    const currentRadiusPx = currentSource
      ? this.projectedSourceRadius(currentSource, cameraRight)
      : null;
    const explicitAnchor = this.nodes.get(this.lockedId ?? this.selectedId ?? "");
    let explicitSource: ForceNode | undefined;
    if (
      explicitAnchor
      && explicitAnchor.kind !== "source"
      && camera.position.distanceToSquared(
        this.projectionPoint.set(explicitAnchor.x, explicitAnchor.y, explicitAnchor.z),
      ) <= 220 * 220
    ) {
      explicitSource = this.sourceNodesById.get(explicitAnchor.sourceId);
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
      ? this.sourceNodesById.get(nextLatchedSourceId)
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
    if (mixChanged || sourceChanged) {
      this.nodes.forEach((node) => {
        this.setObjectOpacity(
          node,
          node.visualOpacity ?? 1,
          node.visuallyEmphasized ?? false,
        );
      });
    }
    this.updateSourceAuraOpacities();
    this.updateNebulaAlphas();
    this.updateNebulaMotionState();
    this.sourceNodeList.forEach((node) => {
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

  evaluateLod(now: number) {
    if (!this.interactive || !this.lodArmed || now - this.lastLodAt < 110) return;
    this.lastLodAt = now;
    const camera = this.graph.camera();
    camera.updateMatrixWorld();
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const cameraRight = this.projectionCameraRight
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize();
    let best: { node: ForceNode; radiusPx: number; distance: number } | null = null;
    this.sourceNodeList.forEach((node) => {
      if (this.latchedDetailSourceId && node.sourceId !== this.latchedDetailSourceId) return;
      const center = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
      if (center.x < -80 || center.x > width + 80 || center.y < -80 || center.y > height + 80) return;
      const radiusPx = this.projectedSourceRadius(node, cameraRight);
      if (radiusPx === null) return;
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

  startLoop(keepAliveMs = 0) {
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

  wakeRendering(settleMs = 1800) {
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
    return updatePointerParallax(this);
  }
  private updateTemporalPresence() {
    return updateTemporalPresence(this);
  }
  private updateTemporalFlight(now: number) {
    return updateTemporalFlight(this, now);
  }

  private timelineWheelSurface(target: EventTarget | null): "canvas" | "label" | null {
    if (target === this.rendererCanvas) return "canvas";
    if (!(target instanceof Element) || !this.host.contains(target)) return null;
    // The pet workspace is a sibling overlay in the explore shell. Its wheel
    // and pointer events must never be interpreted as graph gestures; in
    // particular, submitting an answer may update/focus the graph while the
    // user is still scrolling the answer transcript.
    if (target.closest(MINI_WORKSPACE_SELECTOR)) return null;
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
    if (this.lockedId || this.selectedId || this.keyboardFocusedId) {
      // Release reading focus, but keep the contextual mini workspace open:
      // wheel travel changes the scene rather than dismissing what was read.
      this.callbacks.onSelectionClear({ dismissWorkspace: false });
      if (this.lockedId || this.selectedId || this.keyboardFocusedId) {
        this.clearSelection();
      }
    }
    const flightActive = this.timelineJourney.enabled
      && this.flightConfig !== null
      && this.sourceNavigationPhase !== "overview";
    const hoveredNode = this.hoveredId ? this.nodes.get(this.hoveredId) : null;
    if (
      !flightActive
      && !event.ctrlKey
      && !event.metaKey
      && event.deltaY < 0
      && hoveredNode?.kind === "source"
    ) {
      // A source under the pointer owns the first inward wheel gesture. This
      // makes the overview feel like a navigable star map while leaving blank
      // space to OrbitControls for ordinary zooming.
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onSourceWheel?.(hoveredNode.sourceId);
      return;
    }
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
    // A real gesture takes ownership from the automatic core-to-data handoff.
    this.cancelSourceEntryDive();
    if (
      event.deltaY > 0
      && this.appliedFlightDepth <= UNIVERSE_FLIGHT_SETTLE_EPSILON
    ) {
      if (this.sourceNavigationPhase !== "origin") this.markSourceOrigin();
      const exit = advanceUniverseSourceExitGate(this.sourceExitGate, {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        viewportHeight: this.host.clientHeight,
        reducedMotion: this.reducedMotion,
        now: performance.now(),
      });
      this.sourceExitGate = exit.gate;
      if (exit.exitRequested) this.callbacks.onBackRequest?.();
      return;
    }
    const nextFlightState = applyUniverseTemporalFlightWheel(this.flightState, {
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      viewportHeight: this.host.clientHeight,
      reducedMotion: this.reducedMotion,
    });
    if (nextFlightState !== this.flightState) this.markSourceExploring();
    this.flightState = nextFlightState;
    this.wakeRendering(900);
    this.startLoop(900);
  };

  private handlePointerDown = (event: PointerEvent) => {
    if (this.paused || !this.interactive) return;
    if (!this.timelineWheelSurface(event.target)) return;
    this.callbacks.onUserInteraction?.();
    // A deliberate grab owns the camera immediately and brakes the flight.
    this.cancelSourceEntryDive();
    this.flightState = brakeUniverseTemporalFlight(this.flightState);
    if (this.appliedFlightDepth <= UNIVERSE_FLIGHT_SETTLE_EPSILON) {
      this.markSourceOrigin();
    } else {
      this.markSourceExploring();
    }
  };

  private handleControlsStart = () => {
    if (this.paused || !this.interactive) return;
    this.wakeRendering(1_400);
    // A camera gesture wants a steady sky: freeze the ambient drift instead of
    // igniting it, so the background never floats under the user's hand.
    this.cameraCalmUntil = performance.now() + NEBULA_GESTURE_CALM_MS;
    if (this.appliedFlightDepth > UNIVERSE_FLIGHT_SETTLE_EPSILON) {
      this.markSourceExploring();
    }
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
      // Let three-force-graph decide whether the pointer is still over the
      // same star. Clearing here on every canvas move creates a one-frame gap
      // between the DOM card and its WebGL hit target.
      if (target !== this.rendererCanvas && label?.dataset.universeNodeId !== this.hoveredId) {
        this.handleNodeHover(null);
      }
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
    return keyboardCandidates(this);
  }

  private updateKeyboardStatus(candidates = this.keyboardCandidates()) {
    return updateKeyboardStatus(this, candidates);
  }

  clearKeyboardFocus(notify = true, refresh = true) {
    return clearKeyboardFocus(this, notify, refresh);
  }

  private setKeyboardFocus(nodeId: string, candidates: ForceNode[]) {
    return setKeyboardFocus(this, nodeId, candidates);
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
    const hadKeyboardFocus = Boolean(this.keyboardFocusedId);
    const hadReadingFocus = Boolean(this.lockedId || this.selectedId);
    this.clearKeyboardFocus();
    if (this.hoveredId) this.handleNodeHover(null, false, true);
    if (hadReadingFocus) this.callbacks.onSelectionClear();
    else if (!hadKeyboardFocus) this.callbacks.onBackRequest?.();
  };

  updatePixelRatio() {
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
