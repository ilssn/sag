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
  universeLabelBudget,
  type UniverseViewPreferences,
} from "@/lib/universe-view-preferences";
import {
  resolveUniverseDetailSource,
  universeCardMorph,
  universeDeepLoadMilestone,
  universeVisualDetailProgress,
} from "@/lib/universe-presentation";

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
  importance: number;
  statsReady: boolean;
  state: "latent" | "active";
  root: boolean;
  x: number;
  y: number;
  z: number;
}

export interface UniverseSceneLink {
  id: string;
  source: string;
  target: string;
  weight: number;
  virtual: boolean;
}

export interface UniverseSceneData {
  epoch: number;
  nodes: UniverseSceneNode[];
  links: UniverseSceneLink[];
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

export interface UniverseSceneHandle {
  focusOverview: () => void;
  resetOverview: () => void;
  focusResult: () => void;
  focusSource: (sourceId: string) => void;
  focusNode: (nodeId: string) => void;
  lockNode: (nodeId: string) => void;
  unlockNode: () => void;
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
  onNodeClick: (node: UniverseSceneNode) => void;
  onHover: (value: UniverseSceneHover | null) => void;
  onViewChange: (value: UniverseSceneView) => void;
  onSourceLod: (sourceId: string, level: 0 | 1 | 2 | 3) => void;
  onSelectionClear: () => void;
}

interface UniverseSceneText {
  locale: string;
  aria: string;
  exploreSource: (label: string) => string;
  sourceStats: (events: number, entities: number) => string;
  sourceStatsBuilding: (events: number) => string;
  exploreNode: (kind: "event" | "entity", label: string) => string;
  kind: (kind: "event" | "entity") => string;
  relatedEvents: (count: number, category: string) => string;
  extractedEvent: string;
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
  fx?: number;
  fy?: number;
  fz?: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  object?: THREE.Object3D;
  pinned?: boolean;
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
  entryStabilized?: boolean;
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
}

interface NebulaParticle {
  sourceId: string;
  offset: THREE.Vector3;
  alpha: number;
  phase: number;
  twinkle: number;
}

interface SceneLabel {
  nodeId: string;
  kind: "source" | "node";
  element: HTMLButtonElement;
}

interface SceneCallbacks {
  onNodeClick: (node: UniverseSceneNode) => void;
  onHover: (value: UniverseSceneHover | null) => void;
  onViewChange: (value: UniverseSceneView) => void;
  onSourceLod: (sourceId: string, level: 0 | 1 | 2 | 3) => void;
  onSelectionClear: () => void;
}

interface GraphControls {
  enabled: boolean;
  enableDamping?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  panSpeed?: number;
  addEventListener: (name: string, callback: () => void) => void;
  removeEventListener: (name: string, callback: () => void) => void;
}

interface ClusterForce {
  (alpha: number): void;
  initialize: (nodes: ForceNode[], ...args: unknown[]) => void;
}

interface SourceTween {
  startedAt: number;
  duration: number;
  from: Map<string, THREE.Vector3>;
  to: Map<string, THREE.Vector3>;
}

const EVENT_COLOR = new THREE.Color("#f5c451");
const ENTITY_COLOR = new THREE.Color("#75d8e8");
const EVENT_LIGHT_COLOR = new THREE.Color("#b77b0b");
const ENTITY_LIGHT_COLOR = new THREE.Color("#16879a");
const WHITE = new THREE.Color("#ffffff");
const DETAIL_MORPH_RESPONSE_MS = 92;
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

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function sourceColor(sourceId: string) {
  return new THREE.Color(
    SOURCE_PALETTE[Math.floor(stableUnit(sourceId) * SOURCE_PALETTE.length) % SOURCE_PALETTE.length],
  );
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

function makeNebulaMaterial(darkTheme: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) },
      uThemeAlpha: { value: darkTheme ? 1 : 0.96 },
      uTime: { value: 0 },
      uMotion: { value: 1 },
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uMotion;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aShape;
      attribute float aPhase;
      attribute float aTwinkle;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vShape;
      varying float vPulse;

      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vShape = aShape;
        float wave = 0.5 + 0.5 * sin(uTime * (0.72 + aTwinkle * 1.38) + aPhase);
        float glint = pow(wave, mix(2.2, 7.0, aTwinkle));
        float pulse = mix(1.0, 0.8 + glint * 0.5, uMotion * aTwinkle);
        vec3 animatedPosition = position;
        animatedPosition.x += sin(uTime * 0.28 + aPhase) * 0.36 * uMotion * aTwinkle;
        animatedPosition.y += cos(uTime * 0.24 + aPhase) * 0.28 * uMotion * aTwinkle;
        vec4 mvPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
        float perspective = clamp(360.0 / max(1.0, -mvPosition.z), 0.42, 2.2);
        gl_PointSize = max(1.15, aSize * uPixelRatio * perspective * pulse);
        vPulse = mix(0.92, 1.2, glint);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uThemeAlpha;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vShape;
      varying float vPulse;

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(centered);
        float softDot = smoothstep(0.5, 0.04, distanceFromCenter);
        float rayX = smoothstep(0.09, 0.0, abs(centered.x)) * smoothstep(0.5, 0.04, abs(centered.y));
        float rayY = smoothstep(0.09, 0.0, abs(centered.y)) * smoothstep(0.5, 0.04, abs(centered.x));
        float sparkle = max(softDot, max(rayX, rayY));
        float shapeAlpha = mix(softDot, sparkle, vShape);
        if (shapeAlpha < 0.015) discard;
        gl_FragColor = vec4(vColor, min(1.0, shapeAlpha * vAlpha * vPulse * uThemeAlpha));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: darkTheme ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

class UniverseForceSceneEngine {
  private graph: ForceGraph3DInstance<ForceNode, ForceLink>;
  private host: HTMLDivElement;
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
  };
  private nodes = new Map<string, ForceNode>();
  private links: ForceLink[] = [];
  private adjacency = new Map<string, Set<string>>();
  private incidentLinkIds = new Map<string, Set<string>>();
  private focusEdgeIds = new Set<string>();
  private contextEdgeIds = new Set<string>();
  private visibleEdgeIds = new Set<string>();
  private edgeCacheVersion = 0;
  private edgeVisibilityKey = "";
  private sourceHits: SearchSourceHit[] = [];
  private selectedId: string | null = null;
  private lockedId: string | null = null;
  private hoveredId: string | null = null;
  private hoveredFromLabel = false;
  private draggingId: string | null = null;
  private darkTheme = false;
  private interactive = true;
  private reducedMotion = false;
  private paused = true;
  private renderingAwake = false;
  private sleepTimer: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private pointerActive = false;
  private eventTexture = makeSpriteTexture("event");
  private entityTexture = makeSpriteTexture("entity");
  private sourceTexture = makeSpriteTexture("source");
  private sourceHitGeometry = new THREE.SphereGeometry(1, 10, 8);
  private nebulaPoints: THREE.Points | null = null;
  private nebulaParticles: NebulaParticle[] = [];
  private nebulaAlphaKey = "";
  private lastNebulaAnimationAt = 0;
  private sourceSignature = "";
  private labelLayer: HTMLDivElement;
  private labels: SceneLabel[] = [];
  private labelDragSuspended = false;
  private labelDragResumeFrame: number | null = null;
  private loopFrame: number | null = null;
  private loopKeepAliveUntil = 0;
  private lastLabelAt = 0;
  private lastLodAt = 0;
  private lastVisualLodAt = 0;
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
  private sourceTween: SourceTween | null = null;
  private clusterNodes: ForceNode[] = [];
  private dataReady = false;
  private initialFocusTimer: number | null = null;
  private resizeFocusFrame: number | null = null;
  private resizePending = false;
  private didInitialFocus = false;
  private dataEpoch = 0;
  private text: UniverseSceneText;

  constructor(
    host: HTMLDivElement,
    policy: UniversePolicy,
    viewPreferences: UniverseViewPreferences,
    text: UniverseSceneText,
    ForceGraph3D: new (
      element: HTMLElement,
      options?: { controlType?: "orbit"; rendererConfig?: THREE.WebGLRendererParameters },
    ) => ForceGraph3DInstance<ForceNode, ForceLink>,
  ) {
    this.host = host;
    this.policy = policy;
    this.viewPreferences = viewPreferences;
    this.text = text;
    this.host.replaceChildren();
    this.host.style.position = "absolute";
    this.host.style.inset = "0";

    this.graph = new ForceGraph3D(this.host, {
      controlType: "orbit",
      rendererConfig: {
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
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
      .linkVisibility((link) => link.visible)
      .linkColor((link) => this.linkVisualColor(link))
      .linkOpacity(0.32)
      .linkWidth((link) => link.highlighted ? 0.26 : 0.045)
      .linkCurvature((link) => 0.025 + stableUnit(link.id) * 0.055)
      .linkDirectionalParticles((link) => (link.highlighted && !this.reducedMotion ? 2 : 0))
      .linkDirectionalParticleWidth(0.3)
      .linkDirectionalParticleSpeed(0.0022)
      .linkDirectionalParticleColor(() => this.darkTheme
        ? "rgba(250,217,127,.72)"
        : "rgba(166,112,16,.58)")
      .enableNodeDrag(true)
      .enablePointerInteraction(true)
      .showPointerCursor((object) => Boolean(object))
      .warmupTicks(18)
      .cooldownTicks(110)
      .cooldownTime(1400)
      .d3VelocityDecay(0.48)
      .onNodeHover((node) => this.handleNodeHover(node, false))
      .onNodeClick((node, event) => {
        if (
          node.kind !== "source"
          && (this.visualDetailMix < 0.5 || node.sourceId !== this.visualSourceId)
        ) return;
        this.pointerActive = true;
        this.pointerX = event.clientX;
        this.pointerY = event.clientY;
        this.callbacks.onNodeClick(node.sceneNode);
      })
      .onNodeDrag((node, translate) => this.handleNodeDrag(node, translate))
      .onNodeDragEnd((node) => this.pinNode(node))
      .onBackgroundClick(() => {
        this.handleNodeHover(null);
        this.callbacks.onSelectionClear();
      })
      .onEngineTick(() => this.updateLabels(performance.now()))
      .onEngineStop(() => this.updateLabels(performance.now(), true));

    const renderer = this.graph.renderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    const camera = this.graph.camera() as THREE.PerspectiveCamera;
    if (camera.isPerspectiveCamera) {
      camera.near = 0.1;
      camera.far = 100_000;
      camera.updateProjectionMatrix();
    }

    this.controls = this.graph.controls() as GraphControls;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.rotateSpeed = 0.42;
    this.controls.zoomSpeed = 0.76;
    this.controls.panSpeed = 0.52;
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
    this.host.addEventListener("pointerenter", this.handlePointerEnter, { passive: true });
    this.host.addEventListener("pointerleave", this.handlePointerLeave, { passive: true });
    this.host.addEventListener("pointerdown", this.armLod, {
      capture: true,
      passive: true,
    });
    this.host.addEventListener("wheel", this.armLod, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pointermove", this.handleWindowPointerMove, { passive: true });
    window.addEventListener("pointerup", this.handleWindowPointerUp, { passive: true });
    window.addEventListener("pointercancel", this.handleWindowPointerUp, { passive: true });
    window.addEventListener("keydown", this.handleKeyDown);
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
    text: UniverseSceneText;
  }) {
    const themeChanged = this.darkTheme !== options.darkTheme;
    const labelPreferencesChanged =
      this.viewPreferences.priority !== options.viewPreferences.priority
      || this.viewPreferences.labelDensity !== options.viewPreferences.labelDensity
      || this.viewPreferences.visibleKinds.join("|")
        !== options.viewPreferences.visibleKinds.join("|");
    const edgePreferencesChanged =
      this.viewPreferences.edgeDensity !== options.viewPreferences.edgeDensity;
    const leavingInteractiveMode = this.interactive && !options.interactive;
    const localeChanged = this.text.locale !== options.text.locale;
    this.darkTheme = options.darkTheme;
    this.interactive = options.interactive;
    this.reducedMotion = options.reducedMotion;
    this.viewPreferences = options.viewPreferences;
    this.text = options.text;
    this.host.dataset.universeReducedMotion = String(options.reducedMotion);
    this.host.dataset.universePriority = options.viewPreferences.priority;
    this.host.dataset.universeLabelDensity = options.viewPreferences.labelDensity;
    this.host.dataset.universeEdgeDensity = options.viewPreferences.edgeDensity;
    this.controls.enabled = options.interactive;
    this.controls.enableDamping = !options.reducedMotion;
    this.graph
      .enablePointerInteraction(options.interactive)
      .enableNavigationControls(options.interactive)
      .enableNodeDrag(options.interactive)
      .linkOpacity(options.darkTheme ? 0.38 : 0.26);
    if (leavingInteractiveMode) this.resetOverview();
    if (!options.interactive) this.pause();
    this.updatePixelRatio();
    if (themeChanged) {
      this.sourceSignature = "";
      this.rebuildNebula();
      this.updateNodeTheme();
      this.updateObjectOpacities();
    }
    if (this.dataReady && edgePreferencesChanged) {
      this.edgeVisibilityKey = "";
      this.applyHighlight();
    }
    if (this.dataReady && (labelPreferencesChanged || localeChanged)) this.rebuildLabels();
    this.updateNebulaMotionState();
    if (this.shouldAnimateNebula()) {
      this.wakeRendering(1400);
      this.startLoop();
    }
  }

  setSelection(selectedId: string | null) {
    const nextSelectedId = selectedId && this.nodes.has(selectedId) ? selectedId : null;
    if (this.selectedId === nextSelectedId) return;
    this.selectedId = nextSelectedId;
    this.host.dataset.universeSelectedId = nextSelectedId ?? "";
    this.rebuildLabels();
    this.applyHighlight();
    this.updateVisualLayout(performance.now(), true);
  }

  setData(
    data: UniverseSceneData,
    policy: UniversePolicy,
    sourceHits: SearchSourceHit[],
  ) {
    this.policy = policy;
    if (data.epoch !== this.dataEpoch) {
      this.releaseLockedNode(false);
      this.dataEpoch = data.epoch;
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
    const previousHits = this.sourceHits.map((hit) => hit.source_id).join("|");
    const nextHits = sourceHits.map((hit) => hit.source_id).join("|");
    const targets = this.sourceTargets(data.nodes, sourceHits);
    const oldNodes = this.nodes;
    const hasAnimatedEntrants = !this.reducedMotion && data.nodes.some(
      (node) => node.kind !== "source" && !oldNodes.has(node.id),
    );
    const persistentAnchor = oldNodes.get(this.lockedId ?? this.selectedId ?? "");
    const nextNodes = new Map<string, ForceNode>();
    const sceneNodesById = new Map(data.nodes.map((node) => [node.id, node]));
    const expansionAnchors = new Map<string, string>();
    const anchorPriority = (id: string) => {
      if (id === this.lockedId) return 3;
      if (id === this.selectedId) return 2;
      return oldNodes.get(id)?.kind === "event" ? 1 : 0;
    };
    data.links.forEach((link) => {
      const sourceExists = oldNodes.has(link.source);
      const targetExists = oldNodes.has(link.target);
      if (sourceExists === targetExists) return;
      const newId = sourceExists ? link.target : link.source;
      const anchorId = sourceExists ? link.source : link.target;
      const currentAnchor = expansionAnchors.get(newId);
      if (!currentAnchor || anchorPriority(anchorId) > anchorPriority(currentAnchor)) {
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
    const entryIndexBySource = new Map<string, number>();

    data.nodes.forEach((sceneNode) => {
      const existing = oldNodes.get(sceneNode.id);
      const scenePosition = new THREE.Vector3(
        Number.isFinite(sceneNode.x) ? sceneNode.x : 0,
        Number.isFinite(sceneNode.y) ? sceneNode.y : 0,
        Number.isFinite(sceneNode.z) ? sceneNode.z : 0,
      );
      const target = targets.get(sceneNode.sourceId) ?? scenePosition.clone();
      const sourceScene = sourceScenes.get(sceneNode.sourceId);
      const sourceBase = sourceScene
        ? new THREE.Vector3(
            Number.isFinite(sourceScene.x) ? sourceScene.x : 0,
            Number.isFinite(sourceScene.y) ? sourceScene.y : 0,
            Number.isFinite(sourceScene.z) ? sourceScene.z : 0,
          )
        : target;
      const currentSource = currentSources.get(sceneNode.sourceId) ?? target;
      let desired = sceneNode.kind === "source"
        ? currentSource
        : scenePosition.add(currentSource).sub(sourceBase);
      const expansionAnchorId = existing ? undefined : expansionAnchors.get(sceneNode.id);
      const expansionAnchor = expansionAnchorId
        ? oldNodes.get(expansionAnchorId)
        : undefined;
      const expansionAnchorScene = expansionAnchorId
        ? sceneNodesById.get(expansionAnchorId)
        : undefined;
      if (
        expansionAnchor
        && expansionAnchorScene
        && Number.isFinite(expansionAnchor.x)
        && Number.isFinite(expansionAnchor.y)
        && Number.isFinite(expansionAnchor.z)
      ) {
        const localOffset = new THREE.Vector3(
          sceneNode.x - expansionAnchorScene.x,
          sceneNode.y - expansionAnchorScene.y,
          sceneNode.z - expansionAnchorScene.z,
        );
        desired = new THREE.Vector3(
          expansionAnchor.x,
          expansionAnchor.y,
          expansionAnchor.z,
        ).add(localOffset);
      }
      if (existing) {
        existing.kind = sceneNode.kind;
        existing.sourceId = sceneNode.sourceId;
        existing.sceneNode = sceneNode;
        existing.visualOpacity = undefined;
        existing.visuallyEmphasized = undefined;
        existing.renderedEntryOpacity = undefined;
        existing.targetX = desired.x;
        existing.targetY = desired.y;
        existing.targetZ = desired.z;
        existing.entry?.to.copy(desired);
        if (
          hasAnimatedEntrants
          && existing.kind !== "source"
          && !existing.pinned
          && existing.id !== this.lockedId
        ) {
          existing.fx = existing.x;
          existing.fy = existing.y;
          existing.fz = existing.z;
          existing.entryStabilized = true;
        }
        nextNodes.set(sceneNode.id, existing);
        return;
      }
      const entryIndex = entryIndexBySource.get(sceneNode.sourceId) ?? 0;
      entryIndexBySource.set(sceneNode.sourceId, entryIndex + 1);
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
      const entry = sceneNode.kind === "source" || this.reducedMotion
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
        x: entry?.from.x ?? desired.x,
        y: entry?.from.y ?? desired.y,
        z: entry?.from.z ?? desired.z,
        fx: entry?.from.x,
        fy: entry?.from.y,
        fz: entry?.from.z,
        targetX: desired.x,
        targetY: desired.y,
        targetZ: desired.z,
        entry,
        entryOpacity: entry ? 0 : undefined,
      });
    });
    oldNodes.forEach((node, id) => {
      if (!nextNodes.has(id)) this.disposeNodeObject(node);
    });

    this.nodes = nextNodes;
    this.sourceHits = sourceHits;
    if (this.lockedId && !nextNodes.has(this.lockedId)) {
      this.lockedId = null;
      this.host.dataset.universeLockedId = "";
    }
    if (this.selectedId && !nextNodes.has(this.selectedId)) this.selectedId = null;
    this.host.dataset.universeSelectedId = this.selectedId ?? "";
    this.clusterNodes = [...nextNodes.values()];
    this.applySourceTargets(targets, previousHits !== nextHits);

    const oldLinks = new Map(this.links.map((link) => [link.id, link]));
    this.links = data.links
      .filter((link) => nextNodes.has(link.source) && nextNodes.has(link.target) && !link.virtual)
      .map((sceneLink) => {
        const existing = oldLinks.get(sceneLink.id);
        if (existing) {
          existing.source = sceneLink.source;
          existing.target = sceneLink.target;
          existing.sourceId = sceneLink.source;
          existing.targetId = sceneLink.target;
          existing.sceneLink = sceneLink;
          existing.visible = true;
          existing.highlighted = false;
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
        };
      });
    this.rebuildAdjacency();
    this.rebuildEdgeDensityCache();
    this.syncEdgeVisibility(
      this.visualDetailMix >= 0.5
        ? this.hoveredId ?? this.selectedId ?? this.lockedId
        : null,
    );

    this.graph.graphData({ nodes: [...nextNodes.values()], links: this.links });
    const enteringCount = [...nextNodes.values()].filter((node) => node.entry).length;
    this.host.dataset.universeEnteringCount = String(enteringCount);
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
    this.updateVisualLayout(performance.now(), true, false);
    this.rebuildNebula();
    this.rebuildLabels();
    this.applyHighlight();
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
    this.releaseLockedNode(false);
    if (this.hoveredId) this.handleNodeHover(null);
    this.selectedId = null;
    this.pointerActive = false;
    this.draggingId = null;
    this.sourceTween = null;
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
    this.host.dataset.universeDraggingId = "";
    this.host.dataset.universeVisualMode = "overview";
    this.host.dataset.universeDetailSource = "";
    this.host.dataset.universeDetailLatched = "";
    this.host.dataset.universeDetailMix = "0.00";
    this.host.dataset.universeDetailTarget = "0.00";
    this.host.dataset.universeResetState = "overview";
    this.frameOverview(0, true);
    this.updateNodeMorphScales();
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
        bounds.expandByPoint(new THREE.Vector3(
          candidate.x - padding,
          candidate.y - padding,
          candidate.z - padding,
        ));
        bounds.expandByPoint(new THREE.Vector3(
          candidate.x + padding,
          candidate.y + padding,
          candidate.z + padding,
        ));
      });
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const camera = this.graph.camera() as THREE.PerspectiveCamera;
      const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const aspect = Math.max(0.4, this.host.clientWidth / Math.max(1, this.host.clientHeight));
      const distanceY = size.y / Math.max(0.01, 2 * halfFov);
      const distanceX = size.x / Math.max(0.01, 2 * halfFov * aspect);
      const distance = Math.max(178, distanceX, distanceY, size.z * 1.32) * 1.08;
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
    node.targetX = node.x;
    node.targetY = node.y;
    node.targetZ = node.z;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
    this.host.dataset.universeLockedId = nodeId;
    this.pinNode(node);
    this.focusNode(nodeId);
  }

  unlockNode() {
    this.releaseLockedNode();
  }

  pause() {
    this.paused = true;
    this.loopKeepAliveUntil = 0;
    this.host.dataset.universeLoop = "idle";
    this.host.dataset.universePaused = "true";
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    if (this.initialFocusTimer !== null) window.clearTimeout(this.initialFocusTimer);
    if (this.resizeFocusFrame !== null) cancelAnimationFrame(this.resizeFocusFrame);
    if (this.labelDragResumeFrame !== null) cancelAnimationFrame(this.labelDragResumeFrame);
    this.sleepTimer = null;
    this.lodTimer = null;
    this.initialFocusTimer = null;
    this.resizeFocusFrame = null;
    this.labelDragResumeFrame = null;
    this.pendingLod = null;
    this.lodArmed = false;
    this.pointerActive = false;
    this.hoveredId = null;
    this.hoveredFromLabel = false;
    this.draggingId = null;
    this.labelDragSuspended = false;
    this.host.dataset.universeDraggingId = "";
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
    if (this.dataReady) this.applyHighlight();
    this.wakeRendering(1200);
    this.startLoop(120);
  }

  dispose() {
    this.pause();
    if (this.lodTimer !== null) window.clearTimeout(this.lodTimer);
    if (this.initialFocusTimer !== null) window.clearTimeout(this.initialFocusTimer);
    if (this.sleepTimer !== null) window.clearTimeout(this.sleepTimer);
    if (this.resizeFocusFrame !== null) cancelAnimationFrame(this.resizeFocusFrame);
    if (this.labelDragResumeFrame !== null) cancelAnimationFrame(this.labelDragResumeFrame);
    this.controls.removeEventListener("change", this.handleControlsChange);
    this.resizeObserver.disconnect();
    this.host.removeEventListener("pointermove", this.handlePointerMove);
    this.host.removeEventListener("pointerenter", this.handlePointerEnter);
    this.host.removeEventListener("pointerleave", this.handlePointerLeave);
    this.host.removeEventListener("pointerdown", this.armLod, true);
    this.host.removeEventListener("wheel", this.armLod, true);
    window.removeEventListener("pointermove", this.handleWindowPointerMove);
    window.removeEventListener("pointerup", this.handleWindowPointerUp);
    window.removeEventListener("pointercancel", this.handleWindowPointerUp);
    window.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.clearNebula();
    this.nodes.forEach((node) => this.disposeNodeObject(node));
    this.eventTexture.dispose();
    this.entityTexture.dispose();
    this.sourceTexture.dispose();
    this.sourceHitGeometry.dispose();
    this.graph._destructor();
    this.host.replaceChildren();
  }

  private disposeNodeObject(node: ForceNode) {
    node.object?.traverse((child) => {
      const candidate = child as THREE.Object3D & {
        material?: THREE.Material | THREE.Material[];
      };
      if (!candidate.material) return;
      const materials = Array.isArray(candidate.material)
        ? candidate.material
        : [candidate.material];
      materials.forEach((material) => material.dispose());
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
        if (node.kind === "source" || node.pinned) return;
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

  private sourceTargets(nodes: UniverseSceneNode[], hits: SearchSourceHit[]) {
    const targets = new Map<string, THREE.Vector3>();
    nodes
      .filter((node) => node.kind === "source")
      .forEach((node) => targets.set(node.sourceId, new THREE.Vector3(node.x, node.y, node.z)));
    if (!hits.length) return targets;
    hits.forEach((hit, index) => {
      if (!targets.has(hit.source_id)) return;
      if (index === 0) {
        targets.set(hit.source_id, new THREE.Vector3(0, 0, 0));
        return;
      }
      const angle = (index - 1) * 0.92 - Math.min(2, hits.length - 2) * 0.36;
      const distance = 410 + Math.sqrt(index) * 155;
      targets.set(hit.source_id, new THREE.Vector3(
        Math.sin(angle) * distance,
        Math.cos(angle) * distance * 0.48,
        -90 - index * 54,
      ));
    });
    return targets;
  }

  private applySourceTargets(targets: Map<string, THREE.Vector3>, animate: boolean) {
    const sources = [...this.nodes.values()].filter((node) => node.kind === "source");
    const from = new Map<string, THREE.Vector3>();
    const to = new Map<string, THREE.Vector3>();
    sources.forEach((node) => {
      const target = targets.get(node.sourceId) ?? new THREE.Vector3(
        node.sceneNode.x,
        node.sceneNode.y,
        node.sceneNode.z,
      );
      node.targetX = target.x;
      node.targetY = target.y;
      node.targetZ = target.z;
      from.set(node.sourceId, new THREE.Vector3(node.x, node.y, node.z));
      to.set(node.sourceId, target);
      if (!animate || this.reducedMotion) {
        const delta = target.clone().sub(new THREE.Vector3(node.x, node.y, node.z));
        this.translateSourceNodes(node.sourceId, delta);
        node.x = target.x;
        node.y = target.y;
        node.z = target.z;
        node.fx = target.x;
        node.fy = target.y;
        node.fz = target.z;
      }
    });
    if (animate && !this.reducedMotion) {
      this.sourceTween = {
        startedAt: performance.now(),
        duration: 620,
        from,
        to,
      };
      this.startLoop();
    } else {
      this.sourceTween = null;
    }
  }

  private translateSourceNodes(sourceId: string, delta: THREE.Vector3) {
    if (delta.lengthSq() < 0.0001) return;
    this.nodes.forEach((node) => {
      if (node.kind === "source" || node.sourceId !== sourceId || node.pinned) return;
      node.x += delta.x;
      node.y += delta.y;
      node.z += delta.z;
      node.targetX += delta.x;
      node.targetY += delta.y;
      node.targetZ += delta.z;
      if (node.fx !== undefined) node.fx += delta.x;
      if (node.fy !== undefined) node.fy += delta.y;
      if (node.fz !== undefined) node.fz += delta.z;
      node.entry?.from.add(delta);
      node.entry?.to.add(delta);
    });
  }

  private updateSourceTween(now: number) {
    if (!this.sourceTween) return false;
    const progress = Math.min(1, (now - this.sourceTween.startedAt) / this.sourceTween.duration);
    const eased = easeInOutCubic(progress);
    this.sourceTween.to.forEach((target, sourceId) => {
      const source = [...this.nodes.values()].find(
        (node) => node.kind === "source" && node.sourceId === sourceId,
      );
      const start = this.sourceTween?.from.get(sourceId);
      if (!source || !start) return;
      const next = start.clone().lerp(target, eased);
      const delta = next.clone().sub(new THREE.Vector3(source.x, source.y, source.z));
      this.translateSourceNodes(sourceId, delta);
      source.x = next.x;
      source.y = next.y;
      source.z = next.z;
      source.fx = next.x;
      source.fy = next.y;
      source.fz = next.z;
    });
    this.updateNebulaPositions();
    this.graph.refresh();
    if (progress >= 1) {
      this.sourceTween = null;
      this.graph.d3ReheatSimulation();
      const primarySource = this.sourceHits[0]?.source_id;
      if (primarySource) this.focusSource(primarySource);
    }
    return true;
  }

  private updateNodeEntries(now: number) {
    let entering = 0;
    let changed = false;
    let completed = false;
    this.nodes.forEach((node) => {
      const entry = node.entry;
      if (!entry) return;
      const progress = THREE.MathUtils.clamp(
        (now - entry.startedAt) / entry.duration,
        0,
        1,
      );
      if (progress >= 1) {
        node.x = entry.to.x;
        node.y = entry.to.y;
        node.z = entry.to.z;
        node.vx = 0;
        node.vy = 0;
        node.vz = 0;
        if (!node.pinned) {
          node.fx = undefined;
          node.fy = undefined;
          node.fz = undefined;
        }
        node.entry = undefined;
        node.entryOpacity = undefined;
        node.renderedEntryOpacity = undefined;
        this.setObjectOpacity(
          node,
          node.visualOpacity ?? 1,
          node.visuallyEmphasized ?? false,
        );
        completed = true;
        changed = true;
        return;
      }
      entering += 1;
      const eased = easeOutCubic(progress);
      const arcWeight = Math.sin(Math.PI * progress);
      node.x = THREE.MathUtils.lerp(entry.from.x, entry.to.x, eased) + entry.arc.x * arcWeight;
      node.y = THREE.MathUtils.lerp(entry.from.y, entry.to.y, eased) + entry.arc.y * arcWeight;
      node.z = THREE.MathUtils.lerp(entry.from.z, entry.to.z, eased) + entry.arc.z * arcWeight;
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
      node.vx = 0;
      node.vy = 0;
      node.vz = 0;
      node.entryOpacity = progress;
      this.setObjectOpacity(
        node,
        node.visualOpacity ?? 1,
        node.visuallyEmphasized ?? false,
      );
      changed = true;
    });
    this.host.dataset.universeEnteringCount = String(entering);
    if (changed) this.graph.refresh();
    if (completed && entering === 0) {
      this.nodes.forEach((node) => {
        if (!node.entryStabilized) return;
        node.entryStabilized = false;
        if (node.pinned || node.id === this.lockedId) return;
        node.fx = undefined;
        node.fy = undefined;
        node.fz = undefined;
      });
    }
    return entering > 0;
  }

  private cancelNodeEntry(node: ForceNode) {
    if (!node.entry) return;
    node.entry = undefined;
    node.entryOpacity = undefined;
    node.renderedEntryOpacity = undefined;
    this.setObjectOpacity(
      node,
      node.visualOpacity ?? 1,
      node.visuallyEmphasized ?? false,
    );
    this.host.dataset.universeEnteringCount = String(
      [...this.nodes.values()].filter((item) => item.entry).length,
    );
  }

  private createNodeObject(node: ForceNode) {
    if (node.object) return node.object;
    const group = new THREE.Group();
    group.userData.nodeId = node.id;
    let sprite: THREE.Sprite;
    if (node.kind === "event") {
      const material = new THREE.SpriteMaterial({
        map: this.eventTexture,
        color: this.darkTheme ? EVENT_COLOR : EVENT_LIGHT_COLOR,
        transparent: true,
        opacity: node.sceneNode.root ? 0.98 : 0.82,
        depthWrite: false,
        blending: this.darkTheme ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      sprite = new THREE.Sprite(material);
      const size = node.sceneNode.root ? 6.4 : 4.4;
      sprite.scale.set(size, size, size);
      group.add(sprite);
    } else if (node.kind === "entity") {
      const material = new THREE.SpriteMaterial({
        map: this.entityTexture,
        color: this.darkTheme ? ENTITY_COLOR : ENTITY_LIGHT_COLOR,
        transparent: true,
        opacity: node.sceneNode.root ? 0.9 : 0.7,
        depthWrite: false,
        blending: this.darkTheme ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      sprite = new THREE.Sprite(material);
      const size = node.sceneNode.root ? 5.6 : 3.8;
      sprite.scale.set(size, size, size);
      group.add(sprite);
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
    return group;
  }

  private pinNode(node: ForceNode) {
    this.cancelNodeEntry(node);
    node.pinned = true;
    node.fx = node.x;
    node.fy = node.y;
    node.fz = node.z;
    if (node.kind === "source") {
      node.targetX = node.x;
      node.targetY = node.y;
      node.targetZ = node.z;
      this.updateNebulaPositions();
    }
    this.draggingId = null;
    this.host.dataset.universeDraggingId = "";
    node.visualOpacity = undefined;
    node.visuallyEmphasized = undefined;
    this.applyHighlight();
    this.graph.refresh();
  }

  private releaseLockedNode(refresh = true) {
    const node = this.lockedId ? this.nodes.get(this.lockedId) : undefined;
    if (node) {
      node.pinned = false;
      node.fx = undefined;
      node.fy = undefined;
      node.fz = undefined;
    }
    this.lockedId = null;
    this.host.dataset.universeLockedId = "";
    if (!refresh) return;
    this.applyHighlight();
    this.graph.d3ReheatSimulation();
  }

  private handleNodeDrag(
    node: ForceNode,
    translate: { x: number; y: number; z: number },
  ) {
    this.wakeRendering(1000);
    this.cancelNodeEntry(node);
    if (this.draggingId !== node.id) {
      this.draggingId = node.id;
      this.host.dataset.universeDraggingId = node.id;
      node.visualOpacity = undefined;
      node.visuallyEmphasized = undefined;
      this.setObjectOpacity(node, 1, true);
    }
    node.targetX = node.x;
    node.targetY = node.y;
    node.targetZ = node.z;
    if (node.kind === "source") {
      this.translateSourceNodes(
        node.sourceId,
        new THREE.Vector3(translate.x, translate.y, translate.z),
      );
      this.updateNebulaPositions();
    }
    this.updateLabels(performance.now(), true);
  }

  private rebuildAdjacency() {
    this.adjacency = new Map();
    this.incidentLinkIds = new Map();
    this.links.forEach((link) => {
      const source = link.sourceId || endpointId(link.source);
      const target = link.targetId || endpointId(link.target);
      if (!this.adjacency.has(source)) this.adjacency.set(source, new Set());
      if (!this.adjacency.has(target)) this.adjacency.set(target, new Set());
      if (!this.incidentLinkIds.has(source)) this.incidentLinkIds.set(source, new Set());
      if (!this.incidentLinkIds.has(target)) this.incidentLinkIds.set(target, new Set());
      this.adjacency.get(source)?.add(target);
      this.adjacency.get(target)?.add(source);
      this.incidentLinkIds.get(source)?.add(link.id);
      this.incidentLinkIds.get(target)?.add(link.id);
    });
  }

  /**
   * Builds the stable edge skeletons once per graph update. Hover and selection
   * only union the anchor's incident edge ids into these cached sets, avoiding a
   * sort on every pointer move.
   */
  private rebuildEdgeDensityCache() {
    const rankedLinks = this.links
      .map((link) => {
        const source = this.nodes.get(link.sourceId || endpointId(link.source));
        const target = this.nodes.get(link.targetId || endpointId(link.target));
        const activeEndpoints = Number(source?.sceneNode.state === "active")
          + Number(target?.sceneNode.state === "active");
        const rootEndpoints = Number(Boolean(source?.sceneNode.root))
          + Number(Boolean(target?.sceneNode.root));
        const importance = (source?.sceneNode.importance ?? 0)
          + (target?.sceneNode.importance ?? 0);
        return {
          link,
          score: rootEndpoints * 1_000
            + activeEndpoints * 100
            + link.sceneLink.weight * 20
            + importance,
        };
      })
      .sort((left, right) =>
        right.score - left.score || left.link.id.localeCompare(right.link.id))
      .map(({ link }) => link);
    const concreteNodeCount = [...this.nodes.values()]
      .filter((node) => node.kind !== "source").length;
    const focusBudget = Math.min(
      rankedLinks.length,
      Math.max(6, Math.ceil(Math.sqrt(Math.max(1, concreteNodeCount)) * 1.6)),
    );
    const contextBudget = Math.min(
      rankedLinks.length,
      Math.max(focusBudget, Math.ceil(concreteNodeCount * 0.48)),
    );

    const selectSkeleton = (limit: number, seed: ReadonlySet<string> = new Set()) => {
      const selected = new Set(seed);
      const coveredNodes = new Set<string>();
      const rememberEndpoints = (link: ForceLink) => {
        coveredNodes.add(link.sourceId || endpointId(link.source));
        coveredNodes.add(link.targetId || endpointId(link.target));
      };
      rankedLinks.forEach((link) => {
        if (selected.has(link.id)) rememberEndpoints(link);
      });
      rankedLinks.forEach((link) => {
        if (selected.size >= limit || selected.has(link.id)) return;
        const source = link.sourceId || endpointId(link.source);
        const target = link.targetId || endpointId(link.target);
        if (coveredNodes.has(source) && coveredNodes.has(target)) return;
        selected.add(link.id);
        rememberEndpoints(link);
      });
      rankedLinks.forEach((link) => {
        if (selected.size >= limit || selected.has(link.id)) return;
        selected.add(link.id);
      });
      return selected;
    };

    this.focusEdgeIds = selectSkeleton(focusBudget);
    this.contextEdgeIds = selectSkeleton(contextBudget, this.focusEdgeIds);
    this.edgeCacheVersion += 1;
    this.edgeVisibilityKey = "";
  }

  private syncEdgeVisibility(anchorId: string | null) {
    const key = [
      this.edgeCacheVersion,
      this.viewPreferences.edgeDensity,
      anchorId ?? "",
    ].join(":");
    if (this.edgeVisibilityKey === key) return;
    this.edgeVisibilityKey = key;
    const baseEdgeIds = this.viewPreferences.edgeDensity === "focus"
      ? this.focusEdgeIds
      : this.contextEdgeIds;
    const incidentEdgeIds = anchorId ? this.incidentLinkIds.get(anchorId) : undefined;
    const showAll = this.viewPreferences.edgeDensity === "all";
    const visibleEdgeIds = new Set<string>();
    this.links.forEach((link) => {
      const visible = showAll
        || baseEdgeIds.has(link.id)
        || Boolean(incidentEdgeIds?.has(link.id));
      link.visible = visible;
      if (visible) visibleEdgeIds.add(link.id);
    });
    this.visibleEdgeIds = visibleEdgeIds;
    this.host.dataset.universeRenderedRelations = String(visibleEdgeIds.size);
  }

  private handleNodeHover(node: ForceNode | null, fromLabel = false) {
    if (node && !this.pointerActive) return;
    if (
      node?.kind !== "source"
      && (this.visualDetailMix < 0.5 || node?.sourceId !== this.visualSourceId)
    ) {
      node = null;
    }
    const nextId = node?.id ?? null;
    if (nextId === this.hoveredId) return;
    this.wakeRendering(700);
    this.hoveredId = nextId;
    this.hoveredFromLabel = Boolean(node && fromLabel);
    if (
      node?.kind !== "source"
      && node?.sceneNode.state === "active"
      && !this.labels.some((label) => label.nodeId === node.id)
    ) {
      this.rebuildLabels();
    }
    this.applyHighlight();
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
    const anchorId = this.visualDetailMix >= 0.5
      ? this.hoveredId ?? this.selectedId ?? this.lockedId
      : null;
    const anchor = anchorId ? this.nodes.get(anchorId) : undefined;
    const neighbors = anchorId ? this.adjacency.get(anchorId) ?? new Set<string>() : null;
    const hitRank = new Map(this.sourceHits.map((hit, index) => [hit.source_id, index]));
    let relationCount = 0;
    this.syncEdgeVisibility(anchorId);
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
      if (anchorId) {
        if (node.id === anchorId) opacity = 1;
        else if (neighbors?.has(node.id)) opacity = 0.92;
        else if (node.kind === "source" && anchor?.sourceId === node.sourceId) {
          opacity = 0.38;
        } else opacity = 0.18;
      } else if (hitRank.size) {
        const rank = hitRank.get(node.sourceId);
        opacity = rank === 0 ? 1 : rank !== undefined ? 0.58 : 0.16;
      } else if (node.kind !== "source" && node.sceneNode.state !== "active") {
        opacity = 0.26;
      }
      const overviewSourceHovered = node.kind === "source"
        && this.visualDetailMix < 0.5
        && node.id === this.hoveredId;
      this.setObjectOpacity(node, opacity, node.id === anchorId || overviewSourceHovered);
    });
    this.labels.forEach((label) => {
      if (label.kind !== "node") return;
      label.element.dataset.expanded = String(
        label.nodeId === this.selectedId,
      );
    });
    this.host.dataset.universeRenderedRelations = String(this.visibleEdgeIds.size);
    this.host.dataset.universeHighlightedRelations = String(relationCount);
    this.host.dataset.universeRelationAnchor = anchorId ?? "";
    this.updateNebulaAlphas();
    this.graph.refresh();
    this.sortLabelsForLayout();
    this.updateLabels(performance.now(), true);
  }

  private updateObjectOpacities() {
    this.applyHighlight();
  }

  private setObjectOpacity(node: ForceNode, opacity: number, emphasized: boolean) {
    const entryOpacity = node.entryOpacity ?? 1;
    if (
      node.visualOpacity === opacity
      && node.visuallyEmphasized === emphasized
      && node.renderedEntryOpacity === entryOpacity
    ) return;
    node.visualOpacity = opacity;
    node.visuallyEmphasized = emphasized;
    node.renderedEntryOpacity = entryOpacity;
    const object = node.object;
    if (!object) return;
    const entryScale = 0.28 + easeOutCubic(entryOpacity) * 0.72;
    object.scale.setScalar(
      (emphasized ? 1.18 : 1) * entryScale * this.nodeMorphScale(node),
    );
    object.traverse((child) => {
      if (child.userData.hitArea) return;
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
            ? node.sceneNode.root ? 0.98 : 0.82
            : node.sceneNode.root ? 0.9 : 0.7);
        const detailFactor = child.userData.sourceAura
          ? Math.max(0, 1 - this.visualDetailMix * 1.15)
          : 1;
        material.opacity = entryOpacity <= 0.001
          ? 0
          : Math.max(
              child.userData.sourceAura ? 0 : 0.035 * entryOpacity,
              base * opacity * entryOpacity * detailFactor,
            );
      });
    });
  }

  private nodeMorphScale(node: ForceNode) {
    if (node.kind === "source") return 1;
    const progress = node.sourceId === this.visualSourceId ? this.visualDetailMix : 0;
    return 0.82 + easeOutCubic(progress) * 0.18;
  }

  private updateNodeMorphScales() {
    this.nodes.forEach((node) => {
      if (!node.object || node.kind === "source") return;
      const entryOpacity = node.entryOpacity ?? 1;
      const entryScale = 0.28 + easeOutCubic(entryOpacity) * 0.72;
      node.object.scale.setScalar(
        (node.visuallyEmphasized ? 1.18 : 1) * entryScale * this.nodeMorphScale(node),
      );
    });
  }

  private updateSourceAuraOpacities() {
    const detailFactor = Math.max(0, 1 - this.visualDetailMix * 1.15);
    this.nodes.forEach((node) => {
      if (node.kind !== "source") return;
      node.object?.traverse((child) => {
        if (!child.userData.sourceAura) return;
        const material = (child as THREE.Sprite).material as THREE.SpriteMaterial;
        const base = typeof child.userData.baseOpacity === "number"
          ? child.userData.baseOpacity
          : this.darkTheme ? 0.24 : 0.18;
        const opacity = node.visualOpacity ?? 1;
        material.opacity = base * opacity * detailFactor;
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
                ? this.darkTheme ? ENTITY_COLOR : ENTITY_LIGHT_COLOR
                : this.sourceVisualColor(node.sourceId),
          );
        }
        if (child.userData.sourceAura) {
          child.userData.baseOpacity = this.darkTheme ? 0.24 : 0.18;
        }
        material.blending = this.darkTheme ? THREE.AdditiveBlending : THREE.NormalBlending;
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
    const budget = mobile
      ? this.policy.proxy_budget_mobile
      : this.policy.proxy_budget_desktop;
    const signature = `${mobile ? "mobile" : "desktop"}:${budget}:` + sources
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
    const weights = sources.map((source) =>
      Math.max(1, Math.log2(source.sceneNode.eventCount + source.sceneNode.entityCount + 2)),
    );
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const baseCount = Math.max(
      1,
      Math.min(mobile ? 10 : 14, Math.floor(budget / Math.max(1, sources.length))),
    );
    const weightedBudget = Math.max(0, budget - baseCount * sources.length);
    const particles: NebulaParticle[] = [];
    sources.forEach((source, sourceIndex) => {
      const count = baseCount + Math.floor(
        (weightedBudget * weights[sourceIndex]) / Math.max(1, totalWeight),
      );
      const radius = Math.max(28, source.sceneNode.radius);
      const rotation = new THREE.Euler(
        (stableUnit(`${source.id}:rx`) - 0.5) * 0.7,
        (stableUnit(`${source.id}:ry`) - 0.5) * 0.9,
        stableUnit(`${source.id}:rz`) * Math.PI,
      );
      for (let index = 0; index < count; index += 1) {
        const key = `${source.id}:dust:${index}`;
        const direction = stableDirection(key);
        const coreParticle = stableUnit(`${key}:core`) < 0.38;
        const radial = Math.pow(
          stableUnit(`${key}:radius`),
          coreParticle ? 1.72 : 0.66,
        );
        const arm = Math.sin(radial * Math.PI * 3.2 + stableUnit(`${key}:arm`) * Math.PI * 2);
        const offset = direction.multiplyScalar(radius * radial);
        offset.x *= 1.18 + arm * 0.16;
        offset.y *= coreParticle
          ? 0.42 + stableUnit(`${key}:flatten`) * 0.16
          : 0.48 + stableUnit(`${key}:flatten`) * 0.2;
        offset.z *= 0.78;
        offset.applyEuler(rotation);
        const twinkle = Math.pow(stableUnit(`${key}:twinkle`), 1.18);
        particles.push({
          sourceId: source.sourceId,
          offset,
          alpha: (coreParticle ? 0.28 : 0.21)
            + stableUnit(`${key}:alpha`) * (coreParticle ? 0.58 : 0.54),
          phase: stableUnit(`${key}:phase`) * Math.PI * 2,
          twinkle,
        });
      }
    });
    this.host.dataset.universeParticleCount = String(particles.length);
    this.nebulaParticles = particles;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particles.length * 3);
    const colors = new Float32Array(particles.length * 3);
    const sizes = new Float32Array(particles.length);
    const alphas = new Float32Array(particles.length);
    const shapes = new Float32Array(particles.length);
    const phases = new Float32Array(particles.length);
    const twinkles = new Float32Array(particles.length);
    particles.forEach((particle, index) => {
      const color = this.sourceVisualColor(particle.sourceId).lerp(
        WHITE,
        stableUnit(`${particle.sourceId}:${index}:white`) * (this.darkTheme ? 0.3 : 0.12),
      );
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = 1.3
        + stableUnit(`${particle.sourceId}:${index}:size`) * 3.25
        + (particle.twinkle > 0.86 ? 0.65 : 0);
      alphas[index] = particle.alpha;
      shapes[index] = particle.twinkle > 0.84 ? 1 : 0;
      phases[index] = particle.phase;
      twinkles[index] = 0.18 + particle.twinkle * 0.82;
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
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
    this.updateNebulaMotionState();
    if (this.shouldAnimateNebula()) {
      this.wakeRendering(1400);
      this.startLoop();
    }
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
    const anchor = this.nodes.get(this.hoveredId ?? this.selectedId ?? "");
    const modeKey = anchor
      ? `anchor:${anchor.kind}:${anchor.sourceId}`
      : this.sourceHits.length
        ? `hits:${this.sourceHits.map((hit) => hit.source_id).join("|")}`
        : "default";
    if (!force && modeKey === this.nebulaAlphaKey) return;
    this.nebulaAlphaKey = modeKey;
    const alpha = this.nebulaPoints.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const hitRank = new Map(this.sourceHits.map((hit, index) => [hit.source_id, index]));
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
  }

  private nebulaMotionStrength() {
    if (
      !this.nebulaPoints
      || !this.interactive
      || this.reducedMotion
      || this.reportedViewSourceId
      || document.visibilityState !== "visible"
    ) return 0;
    return THREE.MathUtils.clamp((0.52 - this.visualDetailMix) / 0.22, 0, 1);
  }

  private shouldAnimateNebula() {
    return this.nebulaMotionStrength() > 0.01;
  }

  private updateNebulaMotionState() {
    const strength = this.nebulaMotionStrength();
    const active = strength > 0.01;
    this.host.dataset.universeNebulaMotion = active ? "active" : "idle";
    if (!this.nebulaPoints) return;
    const material = this.nebulaPoints.material as THREE.ShaderMaterial;
    material.uniforms.uMotion.value = strength;
  }

  private updateNebulaAnimation(now: number) {
    const strength = this.nebulaMotionStrength();
    const active = strength > 0.01;
    if (!this.nebulaPoints) return false;
    const material = this.nebulaPoints.material as THREE.ShaderMaterial;
    material.uniforms.uMotion.value = strength;
    if (!active) return false;
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
    if (!this.nebulaPoints) {
      this.host.dataset.universeParticleCount = "0";
      return;
    }
    this.graph.scene().remove(this.nebulaPoints);
    this.nebulaPoints.geometry.dispose();
    const material = this.nebulaPoints.material;
    (Array.isArray(material) ? material : [material]).forEach((item) => item.dispose());
    this.nebulaPoints = null;
    this.nebulaParticles = [];
    this.nebulaAlphaKey = "";
    this.lastNebulaAnimationAt = 0;
    this.host.dataset.universeNebulaMotion = "idle";
    this.host.dataset.universeParticleCount = "0";
  }

  private sourceVisualColor(sourceId: string) {
    const color = sourceColor(sourceId);
    if (!this.darkTheme) color.offsetHSL(0, 0.04, -0.14);
    return color;
  }

  private linkVisualColor(link: ForceLink) {
    if (link.highlighted) {
      return this.darkTheme
        ? "rgba(160, 241, 255, 1)"
        : "rgba(6, 113, 134, 1)";
    }
    if (this.hoveredId || this.selectedId) {
      return this.darkTheme
        ? "rgba(91, 116, 122, 0.28)"
        : "rgba(112, 137, 142, 0.32)";
    }
    return this.darkTheme
      ? "rgba(128, 184, 195, 0.92)"
      : "rgba(66, 112, 122, 0.88)";
  }

  private rebuildLabels() {
    const retainedLabelRank = new Map(
      this.labels
        .filter((label) => label.kind === "node")
        .map((label, index) => [label.nodeId, index]),
    );
    this.labelLayer.replaceChildren();
    this.labels = [];
    const mobile = this.host.clientWidth < 768;
    const sourceRank = new Map(this.sourceHits.map((hit, index) => [hit.source_id, index]));
    const focusId = this.hoveredId ?? this.selectedId;
    const focusNeighbors = focusId ? this.adjacency.get(focusId) ?? new Set<string>() : null;
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
    const visibleKinds = new Set(this.viewPreferences.visibleKinds);
    const labelBudget = universeLabelBudget(
      Math.max(1, this.host.clientWidth),
      Math.max(1, this.host.clientHeight),
      this.viewPreferences.labelDensity,
      this.viewPreferences.priority,
      this.viewPreferences.visibleKinds,
    );
    const prioritize = (left: ForceNode, right: ForceNode) => {
      const emphasisRank = (node: ForceNode) =>
        node.id === this.selectedId ? 0 : node.id === this.hoveredId ? 1 : 2;
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
      && visibleKinds.has(node.kind)
      && node.sceneNode.state === "active"
      && node.sourceId === this.visualSourceId,
    );
    const activeNodes = [
      ...candidates
        .filter((node) => node.kind === "event")
        .sort(prioritize)
        .slice(0, labelBudget.events),
      ...candidates
        .filter((node) => node.kind === "entity")
        .sort(prioritize)
        .slice(0, labelBudget.entities),
    ]
      .sort(prioritize)
      .slice(0, labelBudget.total);

    sources.forEach((node) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "sag-nebula-label";
      element.dataset.universeNodeId = node.id;
      element.setAttribute("aria-label", this.text.exploreSource(node.sceneNode.label));
      element.style.setProperty(
        "--nebula-color",
        `#${this.sourceVisualColor(node.sourceId).getHexString()}`,
      );
      element.style.setProperty(
        "--nebula-phase",
        `${(-1.2 - stableUnit(`${node.id}:beacon-phase`) * 4.8).toFixed(2)}s`,
      );
      this.bindLabelInteraction(element, node);
      const marker = document.createElement("span");
      marker.className = "sag-nebula-label__marker";
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = node.sceneNode.label;
      const meta = document.createElement("small");
      meta.textContent = node.sceneNode.statsReady
        ? this.text.sourceStats(node.sceneNode.eventCount, node.sceneNode.entityCount)
        : this.text.sourceStatsBuilding(node.sceneNode.eventCount);
      copy.append(title, meta);
      element.append(marker, copy);
      this.labelLayer.appendChild(element);
      this.labels.push({ nodeId: node.id, kind: "source", element });
    });
    activeNodes.forEach((node) => {
      const nodeKind = node.kind === "event" ? "event" : "entity";
      const element = document.createElement("button");
      element.type = "button";
      element.className = "sag-universe-node-label";
      element.dataset.universeNodeId = node.id;
      element.dataset.kind = node.kind;
      element.dataset.expanded = String(
        node.id === this.selectedId,
      );
      element.dataset.compact = String(
        node.kind === "entity" && node.id !== this.selectedId,
      );
      element.setAttribute(
        "aria-label",
        this.text.exploreNode(nodeKind, node.sceneNode.label),
      );
      this.bindLabelInteraction(element, node);

      const eyebrow = document.createElement("span");
      eyebrow.className = "sag-universe-node-label__eyebrow";
      const marker = document.createElement("span");
      marker.className = "sag-universe-node-label__marker";
      const eyebrowText = document.createElement("span");
      eyebrowText.textContent = `${this.text.kind(nodeKind)} · ${node.sceneNode.category}`;
      eyebrow.append(marker, eyebrowText);

      const title = document.createElement("strong");
      title.textContent = node.sceneNode.label;
      title.title = node.sceneNode.label;
      const summary = document.createElement("p");
      const summaryText = node.sceneNode.description || (node.kind === "entity"
        ? this.text.relatedEvents(node.sceneNode.relatedCount, node.sceneNode.category)
        : node.sceneNode.category || this.text.extractedEvent);
      summary.textContent = summaryText;
      summary.title = summaryText;
      element.append(eyebrow, title, summary);
      this.labelLayer.appendChild(element);
      this.labels.push({ nodeId: node.id, kind: "node", element });
    });
    this.host.dataset.universeEventLabelCount = String(
      activeNodes.filter((node) => node.kind === "event").length,
    );
    this.host.dataset.universeEntityLabelCount = String(
      activeNodes.filter((node) => node.kind === "entity").length,
    );
    this.sortLabelsForLayout();
    this.updateLabels(performance.now(), true);
  }

  private sortLabelsForLayout() {
    this.labels.sort((left, right) => {
      const layoutRank = (label: SceneLabel) => {
        if (label.nodeId === this.selectedId) return 0;
        if (label.nodeId === this.hoveredId) return 1;
        return label.kind === "source" ? 2 : 3;
      };
      return layoutRank(left) - layoutRank(right);
    });
  }

  private bindLabelInteraction(element: HTMLButtonElement, node: ForceNode) {
    const suspendGraphDrag = (event: PointerEvent) => {
      event.stopPropagation();
      if (this.labelDragResumeFrame !== null) {
        cancelAnimationFrame(this.labelDragResumeFrame);
        this.labelDragResumeFrame = null;
      }
      this.labelDragSuspended = true;
      this.graph.enableNodeDrag(false);
    };
    const resumeGraphDrag = (event: PointerEvent) => {
      event.stopPropagation();
      this.scheduleLabelDragResume();
    };
    const focusNode = (event: PointerEvent) => {
      this.pointerActive = true;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.handleNodeHover(node, true);
    };
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks.onNodeClick(node.sceneNode);
    });
    element.addEventListener("pointerdown", suspendGraphDrag);
    element.addEventListener("pointerup", resumeGraphDrag);
    element.addEventListener("pointercancel", resumeGraphDrag);
    element.addEventListener("pointerenter", focusNode);
    element.addEventListener("pointermove", focusNode, { passive: true });
    element.addEventListener("pointerleave", () => this.handleNodeHover(null));
    element.addEventListener("focus", () => {
      if (this.hoveredId === node.id) return;
      this.hoveredId = node.id;
      this.hoveredFromLabel = true;
      this.applyHighlight();
      const rect = element.getBoundingClientRect();
      this.callbacks.onHover({
        node: node.sceneNode,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    });
    element.addEventListener("blur", () => {
      if (this.hoveredId === node.id) this.handleNodeHover(null);
    });
  }

  private scheduleLabelDragResume() {
    if (!this.labelDragSuspended) return;
    if (this.labelDragResumeFrame !== null) cancelAnimationFrame(this.labelDragResumeFrame);
    this.labelDragResumeFrame = requestAnimationFrame(() => {
      this.labelDragResumeFrame = null;
      this.labelDragSuspended = false;
      this.graph.enableNodeDrag(this.interactive);
    });
  }

  private updateLabels(now: number, force = false) {
    if (!force && now - this.lastLabelAt < 32) return;
    this.lastLabelAt = now;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const mobile = width < 768;
    const camera = this.graph.camera();
    const panelRect = this.miniPanelRect();
    const summaryRect = this.relativeOverlayRect("[data-universe-summary='true']", 8);
    const progressRect = this.relativeOverlayRect("[data-universe-load-progress='true']", 8);
    const inspectorRect = this.relativeOverlayRect("[data-universe-inspector='true']", 8);
    const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const cardMorph = universeCardMorph(this.visualDetailMix);
    const sourceReveal = 1 - THREE.MathUtils.smoothstep(this.visualDetailMix, 0, 0.72);

    this.labels.forEach((label) => {
      const node = this.nodes.get(label.nodeId);
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Number.isFinite(node.z)) {
        label.element.hidden = true;
        label.element.style.display = "none";
        label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
        return;
      }
      const belongsToVisualSource = node.sourceId === this.visualSourceId;
      const sourceHovered = label.kind === "source" && node.id === this.hoveredId;
      const layoutOpacity = label.kind === "source"
        ? sourceReveal
        : belongsToVisualSource ? cardMorph.reveal : 0;
      const entryReveal = label.kind === "node"
        ? THREE.MathUtils.clamp(((node.entryOpacity ?? 1) - 0.16) / 0.84, 0, 1)
        : 1;
      const visibleOpacity = layoutOpacity * entryReveal;
      if (visibleOpacity <= 0.01) {
        label.element.hidden = true;
        label.element.style.display = "none";
        label.element.style.pointerEvents = "none";
        label.element.style.transform = "translate3d(-9999px, -9999px, 0)";
        return;
      }
      const projected = new THREE.Vector3(node.x, node.y, node.z).project(camera);
      const screen = this.graph.graph2ScreenCoords(node.x, node.y, node.z);
      const inFrame = projected.z > -1
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

      const emphasized = node.id === this.hoveredId || node.id === this.selectedId;
      const expanded = node.id === this.selectedId;
      const compact = label.kind === "node" && node.kind === "entity" && !expanded;
      label.element.dataset.compact = String(compact);
      const sourceBeaconSize = mobile ? 44 : 48;
      const sourceInfoWidth = mobile ? 138 : 154;
      const sourceInfoHeight = mobile ? 40 : 44;
      const sourceInfoGap = 8;
      const baseLabelWidth = label.kind === "source"
        ? sourceBeaconSize
        : compact
          ? mobile ? 112 : 136
        : mobile
          ? expanded ? 204 : 184
          : expanded ? 244 : 216;
      const baseLabelHeight = label.kind === "source"
        ? sourceBeaconSize
        : compact
          ? mobile ? 26 : 28
        : mobile
          ? expanded ? 82 : 70
          : expanded ? 94 : 78;
      const labelScale = label.kind === "source" ? 1 : cardMorph.scale;
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
      const nodeLabelGaps = compact
        ? [labelGap, labelGap + 18, labelGap + 36]
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
        const overlapsPanel = [panelRect, summaryRect, progressRect, inspectorRect].some((overlay) => overlay
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
      const rect = candidates.find((candidate) =>
        !blockedByViewportOrPanel(candidate) && !overlapsPlacedLabel(candidate))
        ?? (emphasized
          ? candidates.find((candidate) => !blockedByViewportOrPanel(candidate))
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
          emphasized ? 1 : label.kind === "source" ? 0.94 : compact ? 0.9 : 0.84
        ),
      );
      label.element.style.pointerEvents = label.kind === "source"
        ? visibleOpacity >= 0.58 ? "auto" : "none"
        : this.visualDetailMix >= 0.5 && cardMorph.reveal >= 0.72 ? "auto" : "none";
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
          cardMorph.eyebrow.toFixed(3),
        );
        label.element.style.setProperty(
          "--universe-card-summary-opacity",
          cardMorph.summary.toFixed(3),
        );
        label.element.style.setProperty(
          "--universe-card-summary-y",
          `${((1 - cardMorph.summary) * 3).toFixed(2)}px`,
        );
        label.element.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${labelScale})`;
      }
      if (visibleOpacity >= 0.22) placed.push(rect);
    });
  }

  private miniPanelRect() {
    return this.relativeOverlayRect("[data-mini-workspace='true']", 10);
  }

  private relativeOverlayRect(selector: string, padding: number) {
    const panel = document.querySelector<HTMLElement>(selector);
    if (!panel) return null;
    const hostRect = this.host.getBoundingClientRect();
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
    const panel = this.miniPanelRect();
    if (panel) {
      const panelCenterX = (panel.left + panel.right) / 2;
      if (panelCenterX < width / 2) left = Math.max(left, panel.right + 18);
      else right = Math.min(right, panel.left - 18);
      const panelCenterY = (panel.top + panel.bottom) / 2;
      if (panel.bottom - panel.top > height * 0.62) {
        if (panelCenterY < height / 2) top = Math.max(top, panel.bottom + 16);
        else bottom = Math.min(bottom, panel.top - 16);
      }
    }
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
    if (this.hoveredId) this.handleNodeHover(null);
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

    const nextLatchedSourceId = suppressDetail
      ? null
      : resolveUniverseDetailSource({
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
    const naturalTarget = visual
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
    if (Math.abs(nextTarget - nextMix) <= 0.002) nextMix = nextTarget;
    if (!this.reducedMotion && Math.abs(nextTarget - nextMix) > 0.002) {
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
    this.updateNodeMorphScales();
    this.updateSourceAuraOpacities();
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
        || this.sourceTween
        || this.draggingId
        || performance.now() < this.loopKeepAliveUntil
      ) {
        if (!this.paused) this.wakeRendering(500);
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
    const tweening = this.updateSourceTween(now);
    const entering = this.updateNodeEntries(now);
    this.updateVisualLayout(now);
    const nebulaAnimating = this.updateNebulaAnimation(now);
    this.updateLabels(now);
    this.evaluateLod(now);
    if (tweening || entering || nebulaAnimating || now < this.loopKeepAliveUntil) {
      this.loopFrame = requestAnimationFrame(this.loop);
    } else {
      this.host.dataset.universeLoop = "idle";
    }
  };

  private handleControlsChange = () => {
    if (this.paused) return;
    this.updateVisualLayout(performance.now());
    this.updateLabels(performance.now(), true);
    this.evaluateLod(performance.now());
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
  };

  private handlePointerLeave = () => {
    if (this.paused) return;
    this.pointerActive = false;
    if (this.hoveredId) this.handleNodeHover(null);
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState !== "visible" || !this.interactive) return;
    this.resume();
    this.updateNebulaMotionState();
    this.wakeRendering(1200);
    this.startLoop();
  };

  private handleWindowPointerMove = (event: PointerEvent) => {
    if (this.paused || !this.interactive) return;
    const target = event.target;
    if (!(target instanceof Node) || this.host.contains(target)) return;
    this.pointerActive = false;
    if (this.hoveredId) this.handleNodeHover(null);
  };

  private handleWindowPointerUp = () => {
    if (this.paused || !this.interactive) return;
    this.scheduleLabelDragResume();
    if (!this.draggingId) return;
    const node = this.nodes.get(this.draggingId);
    if (node) this.pinNode(node);
    else {
      this.draggingId = null;
      this.host.dataset.universeDraggingId = "";
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.paused || !this.interactive) return;
    if (event.key !== "Escape") return;
    if (this.hoveredId) this.handleNodeHover(null);
    if (this.selectedId) this.callbacks.onSelectionClear();
  };

  private armLod = () => {
    if (this.paused || !this.interactive) return;
    this.wakeRendering(1400);
    this.lodArmed = true;
    this.startLoop(this.policy.lod_debounce_ms + 240);
  };

  private updatePixelRatio() {
    const mobile = this.host.clientWidth < 768;
    const concreteNodes = [...this.nodes.values()].filter((node) => node.kind !== "source").length;
    const qualityCap = this.reducedMotion
      ? 1
      : mobile
        ? concreteNodes > 220 ? 1 : 1.18
        : concreteNodes > 600 ? 1.18 : concreteNodes > 320 ? 1.32 : 1.5;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, qualityCap);
    this.host.dataset.universePixelRatio = pixelRatio.toFixed(2);
    this.graph.renderer().setPixelRatio(pixelRatio);
    if (this.nebulaPoints) {
      const material = this.nebulaPoints.material as THREE.ShaderMaterial;
      material.uniforms.uPixelRatio.value = pixelRatio;
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
    if (this.resizeFocusFrame !== null) cancelAnimationFrame(this.resizeFocusFrame);
    this.resizeFocusFrame = requestAnimationFrame(() => {
      this.resizeFocusFrame = null;
      const anchorId = this.lockedId ?? this.selectedId;
      if (anchorId) this.focusNode(anchorId);
      else if (this.reportedViewSourceId) this.focusSource(this.reportedViewSourceId);
    });
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
      onNodeClick,
      onHover,
      onViewChange,
      onSourceLod,
      onSelectionClear,
    },
    forwardedRef,
  ) {
    const locale = useLocale();
    const t = useTranslations("UniverseScene");
    const text = React.useMemo<UniverseSceneText>(() => ({
      locale,
      aria: t("aria"),
      exploreSource: (label) => t("exploreSource", { label }),
      sourceStats: (events, entities) => t("sourceStats", { events, entities }),
      sourceStatsBuilding: (events) => t("sourceStatsBuilding", { events }),
      exploreNode: (kind, label) => t("exploreNode", {
        kind: t(`kinds.${kind}`),
        label,
      }),
      kind: (kind) => t(`kinds.${kind}`),
      relatedEvents: (count, category) => t("relatedEvents", { count, category }),
      extractedEvent: t("extractedEvent"),
    }), [locale, t]);
    const hostRef = React.useRef<HTMLDivElement>(null);
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
      onNodeClick,
      onHover,
      onViewChange,
      onSourceLod,
      onSelectionClear,
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
      onNodeClick,
      onHover,
      onViewChange,
      onSourceLod,
      onSelectionClear,
      text,
    };

    React.useEffect(() => {
      if (!hostRef.current) return;
      let cancelled = false;
      const host = hostRef.current;
      void import("3d-force-graph")
        .then(({ default: ForceGraph3D }) => {
          if (cancelled) return;
          const current = latestRef.current;
          const engine = new UniverseForceSceneEngine(
            host,
            current.policy,
            current.viewPreferences,
            current.text,
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
          });
          engine.setOptions({
            interactive: current.interactive,
            reducedMotion: current.reducedMotion,
            darkTheme: current.darkTheme,
            viewPreferences: current.viewPreferences,
            text: current.text,
          });
          if (current.interactive) {
            engine.setData(current.data, current.policy, current.sourceHits);
            engine.setSelection(current.selectedId);
            engine.resume();
          }
        })
        .catch(() => {
          if (!cancelled) host.dataset.universeEngine = "error";
        });
      return () => {
        cancelled = true;
        engineRef.current?.dispose();
        engineRef.current = null;
      };
    }, []);

    React.useEffect(() => {
      engineRef.current?.setCallbacks({
        onNodeClick,
        onHover,
        onViewChange,
        onSourceLod,
        onSelectionClear,
      });
    }, [onHover, onNodeClick, onSelectionClear, onSourceLod, onViewChange]);

    React.useLayoutEffect(() => {
      engineRef.current?.setOptions({
        interactive,
        reducedMotion,
        darkTheme,
        viewPreferences,
        text,
      });
    }, [darkTheme, interactive, reducedMotion, text, viewPreferences]);

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
        pause: () => engineRef.current?.pause(),
        resume: () => engineRef.current?.resume(),
      }),
      [],
    );

    return (
      <div
        ref={hostRef}
        className="absolute inset-0"
        data-universe-scene="three"
        data-universe-engine="loading"
        data-universe-active={interactive}
        data-universe-paused={!interactive}
        data-universe-node-count={data.nodes.length}
        data-universe-link-count={data.links.length}
        role="group"
        aria-label={text.aria}
      />
    );
  },
);
