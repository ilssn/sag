"use client";

/**
 * 轨道图纯层（自 orbital-graph-3d 抽离）：布局、纹理、标签与场景装配工具。
 * 全部为输入 → 产物的确定性函数（依赖 DOM canvas / THREE / CSS2D，不含 React 状态）；
 * 组件层只保留请求生命周期、状态组合与事件接线（frontend.md 模块边界）。
 */

import * as THREE from "three";

import {
  eventEntityNodeId,
  type EventEntityGraphKind,
  type EventEntityGraphSlice,
} from "@/components/features/event-entity-graph-model";

export interface OrbitalLayout {
  positions: Map<string, THREE.Vector3>;
  innerRadius: number;
  outerRadius: number;
}

export interface OrbitalSceneNode {
  id: string;
  kind: EventEntityGraphKind;
  object: THREE.Group;
  position: THREE.Vector3;
  visual: THREE.Sprite | THREE.Mesh;
  visualMaterial: THREE.SpriteMaterial | THREE.MeshStandardMaterial;
  visualKind: "disc" | "plate";
  baseColor: THREE.Color;
  ring: THREE.Sprite;
  ringMaterial: THREE.SpriteMaterial;
  label: HTMLDivElement;
  size: number;
}

export interface OrbitalSceneEdge {
  eventId: string;
  entityId: string;
  curve: THREE.CubicBezierCurve3;
  material: THREE.LineBasicMaterial;
  pulse: THREE.Sprite;
  offset: number;
}

export interface OrbitalSceneApi {
  resetCamera: () => void;
  setAutoRotate: (enabled: boolean) => void;
  setSelected: (nodeId: string | null) => void;
}

export const INNER_RADIUS = 158;
export const OUTER_RADIUS = 424;
export const ENTITY_SIZE_RATIO = 0.6;
export const BASE_EDGE_OPACITY = 0.085;

export const EVENT_COLORS = ["#ff6b7f", "#ec82ad", "#f4a261", "#ff8f70", "#f3c86a"];
const ENTITY_COLORS = ["#5577ff", "#6b9cff", "#8d76ff", "#58c5d8", "#d7def2"];
export const PLATE_COLORS = [
  "#f05d7b",
  "#f48c68",
  "#f2c45e",
  "#53c6a5",
  "#4eb3d3",
  "#6289e8",
  "#8d6ed4",
  "#d96fa5",
];

export type EventSurfaceMode = "nodes" | "plates";

export function hashValue(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function nodeColor(kind: EventEntityGraphKind, key: string) {
  const colors = kind === "event" ? EVENT_COLORS : ENTITY_COLORS;
  return colors[hashValue(key) % colors.length];
}

export function plateColor(key: string, index: number) {
  return PLATE_COLORS[(hashValue(key) + index * 3) % PLATE_COLORS.length];
}

function fibonacciDirection(index: number, count: number, phase = 0) {
  const safeCount = Math.max(1, count);
  const y = 1 - ((index + 0.5) / safeCount) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = (index + phase) * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.16)
    .normalize();
}

export function buildOrbitalLayout(slice: EventEntityGraphSlice): OrbitalLayout {
  const positions = new Map<string, THREE.Vector3>();
  const eventDirections = new Map<string, THREE.Vector3>();

  slice.events.forEach((event, index) => {
    const direction = fibonacciDirection(index, slice.events.length, 0.24);
    eventDirections.set(event.id, direction);
    positions.set(eventEntityNodeId("event", event.id), direction.clone().multiplyScalar(INNER_RADIUS));
  });

  const linkedEvents = new Map<string, string[]>();
  slice.relations.forEach((relation) => {
    const values = linkedEvents.get(relation.entityId) ?? [];
    values.push(relation.eventId);
    linkedEvents.set(relation.entityId, values);
  });

  const anchors = slice.entities.map((entity, index) => {
    const spread = fibonacciDirection(index, slice.entities.length, 0.71);
    const linked = linkedEvents.get(entity.id) ?? [];
    const relatedDirection = linked.reduce((sum, eventId) => {
      const direction = eventDirections.get(eventId);
      return direction ? sum.add(direction) : sum;
    }, new THREE.Vector3());
    if (relatedDirection.lengthSq() < 0.0001) return spread;
    return relatedDirection.normalize().multiplyScalar(0.7).addScaledVector(spread, 0.3).normalize();
  });

  let entityDirections = anchors.map((anchor, index) =>
    anchor
      .clone()
      .multiplyScalar(0.82)
      .addScaledVector(fibonacciDirection(index, anchors.length, 1.13), 0.18)
      .normalize(),
  );
  const minimumDistance = Math.max(0.26, Math.min(0.42, 2.45 / Math.sqrt(Math.max(1, anchors.length))));

  const relaxationIterations = anchors.length > 320 ? 0 : anchors.length > 180 ? 18 : 90;
  for (let iteration = 0; iteration < relaxationIterations; iteration += 1) {
    entityDirections = entityDirections.map((direction, index, values) => {
      const force = new THREE.Vector3();
      values.forEach((other, otherIndex) => {
        if (index === otherIndex) return;
        const delta = direction.clone().sub(other);
        const distance = delta.length();
        if (distance >= minimumDistance || distance < 0.00001) return;
        const tangent = delta.addScaledVector(direction, -delta.dot(direction));
        if (tangent.lengthSq() < 0.00001) return;
        force.addScaledVector(tangent.normalize(), (minimumDistance - distance) * 0.13);
      });
      const anchorTangent = anchors[index]
        .clone()
        .addScaledVector(direction, -anchors[index].dot(direction));
      force.addScaledVector(anchorTangent, 0.012);
      return direction.clone().add(force).normalize();
    });
  }

  slice.entities.forEach((entity, index) => {
    positions.set(
      eventEntityNodeId("entity", entity.id),
      entityDirections[index].clone().multiplyScalar(OUTER_RADIUS),
    );
  });

  return { positions, innerRadius: INNER_RADIUS, outerRadius: OUTER_RADIUS };
}

export function makeAdjacency(slice: EventEntityGraphSlice) {
  const adjacency = new Map<string, string[]>();
  slice.relations.forEach((relation) => {
    const eventId = eventEntityNodeId("event", relation.eventId);
    const entityId = eventEntityNodeId("entity", relation.entityId);
    adjacency.set(eventId, [...(adjacency.get(eventId) ?? []), entityId]);
    adjacency.set(entityId, [...(adjacency.get(entityId) ?? []), eventId]);
  });
  return adjacency;
}

export function makeDegreeMap(slice: EventEntityGraphSlice) {
  const degrees = new Map<string, number>();
  slice.relations.forEach((relation) => {
    const eventId = eventEntityNodeId("event", relation.eventId);
    const entityId = eventEntityNodeId("entity", relation.entityId);
    degrees.set(eventId, (degrees.get(eventId) ?? 0) + 1);
    degrees.set(entityId, (degrees.get(entityId) ?? 0) + 1);
  });
  return degrees;
}

export function makeDiscTexture(fill: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  const center = 80;
  const radius = 52;
  context.clearRect(0, 0, 160, 160);
  context.save();
  context.shadowColor = `${fill}99`;
  context.shadowBlur = 18;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.restore();

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.lineWidth = 9;
  context.strokeStyle = "#101522";
  context.stroke();

  context.beginPath();
  context.arc(center, center, radius - 4.5, 0, Math.PI * 2);
  context.lineWidth = 2;
  context.strokeStyle = "rgba(255,255,255,0.72)";
  context.stroke();

  const highlight = context.createRadialGradient(59, 54, 2, 65, 60, 40);
  highlight.addColorStop(0, "rgba(255,255,255,0.42)");
  highlight.addColorStop(1, "rgba(255,255,255,0)");
  context.beginPath();
  context.arc(center, center, radius - 7, 0, Math.PI * 2);
  context.fillStyle = highlight;
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function makeRingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  context.clearRect(0, 0, 160, 160);
  context.save();
  context.shadowColor = "rgba(255,255,255,0.9)";
  context.shadowBlur = 16;
  context.beginPath();
  context.arc(80, 80, 55, 0, Math.PI * 2);
  context.lineWidth = 4;
  context.strokeStyle = "rgba(255,255,255,0.92)";
  context.stroke();
  context.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makePulseTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);
  const glow = context.createRadialGradient(32, 32, 0, 32, 32, 28);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.22, "rgba(166,205,255,0.95)");
  glow.addColorStop(1, "rgba(83,119,255,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function makeLabel(text: string, kind: EventEntityGraphKind) {
  const element = document.createElement("div");
  element.className = "sag-orbital-label";
  element.dataset.kind = kind;
  element.dataset.visible = "false";
  element.textContent = text;
  element.title = text;
  return element;
}

export function addOrbitRings(scene: THREE.Scene, radius: number, color: string, opacity: number) {
  const circle = (
    pointAt: (angle: number) => THREE.Vector3,
    ringOpacity = opacity,
  ) => {
    const points = Array.from({ length: 129 }, (_, index) =>
      pointAt((index / 128) * Math.PI * 2),
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color,
      transparent: true,
      opacity: ringOpacity,
      dashSize: radius > 200 ? 9 : 6,
      gapSize: radius > 200 ? 13 : 9,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 0;
    scene.add(line);
  };

  circle((angle) => new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  circle((angle) => new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  circle((angle) => new THREE.Vector3(0, Math.cos(angle) * radius, Math.sin(angle) * radius));
  [-0.48, 0.48].forEach((latitude) => {
    const y = radius * latitude;
    const ringRadius = radius * Math.sqrt(1 - latitude * latitude);
    circle(
      (angle) => new THREE.Vector3(Math.cos(angle) * ringRadius, y, Math.sin(angle) * ringRadius),
      opacity * 0.62,
    );
  });
}

export function addBackgroundPoints(scene: THREE.Scene) {
  let seed = 24681357;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions: number[] = [];
  for (let index = 0; index < 280; index += 1) {
    const direction = new THREE.Vector3(
      random() * 2 - 1,
      random() * 2 - 1,
      random() * 2 - 1,
    ).normalize();
    direction.multiplyScalar(620 + random() * 620);
    positions.push(direction.x, direction.y, direction.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xaab6d1,
    size: 1.65,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geometry, material));
}

export interface EventPlateSurface {
  geometries: Map<string, THREE.BufferGeometry>;
  boundaryGeometry: THREE.BufferGeometry;
}

type SurfacePoint = [number, number, number];

function surfacePointKey([x, y, z]: SurfacePoint) {
  return `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
}

function surfaceEdgeKey(first: SurfacePoint, second: SurfacePoint) {
  const firstKey = surfacePointKey(first);
  const secondKey = surfacePointKey(second);
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`;
}

export function buildEventPlateSurface(
  slice: EventEntityGraphSlice,
  layout: OrbitalLayout,
): EventPlateSurface {
  const sourceGeometry = new THREE.IcosahedronGeometry(layout.innerRadius, 4);
  const surfaceGeometry = sourceGeometry.index
    ? sourceGeometry.toNonIndexed()
    : sourceGeometry.clone();
  sourceGeometry.dispose();

  const positions = surfaceGeometry.getAttribute("position");
  const sites = slice.events.map((event) => {
    const id = eventEntityNodeId("event", event.id);
    const position = layout.positions.get(id) ?? new THREE.Vector3(0, 1, 0);
    return { id, position, direction: position.clone().normalize() };
  });
  if (sites.length === 0) {
    surfaceGeometry.dispose();
    return {
      geometries: new Map(),
      boundaryGeometry: new THREE.BufferGeometry(),
    };
  }
  const plateVertices = sites.map(() => [] as number[]);
  const edgeOwners = new Map<
    string,
    { owner: number; first: SurfacePoint; second: SurfacePoint }
  >();
  const boundaryVertices: number[] = [];
  const center = new THREE.Vector3();

  for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 3) {
    const triangle: [SurfacePoint, SurfacePoint, SurfacePoint] = [
      [positions.getX(vertexIndex), positions.getY(vertexIndex), positions.getZ(vertexIndex)],
      [
        positions.getX(vertexIndex + 1),
        positions.getY(vertexIndex + 1),
        positions.getZ(vertexIndex + 1),
      ],
      [
        positions.getX(vertexIndex + 2),
        positions.getY(vertexIndex + 2),
        positions.getZ(vertexIndex + 2),
      ],
    ];
    center
      .set(
        triangle[0][0] + triangle[1][0] + triangle[2][0],
        triangle[0][1] + triangle[1][1] + triangle[2][1],
        triangle[0][2] + triangle[1][2] + triangle[2][2],
      )
      .normalize();

    let owner = 0;
    let bestMatch = -Infinity;
    sites.forEach((site, siteIndex) => {
      const match = center.dot(site.direction);
      if (match > bestMatch) {
        bestMatch = match;
        owner = siteIndex;
      }
    });

    const anchor = sites[owner].position;
    triangle.forEach(([x, y, z]) => {
      plateVertices[owner].push(x - anchor.x, y - anchor.y, z - anchor.z);
    });

    const edges: Array<[SurfacePoint, SurfacePoint]> = [
      [triangle[0], triangle[1]],
      [triangle[1], triangle[2]],
      [triangle[2], triangle[0]],
    ];
    edges.forEach(([first, second]) => {
      const key = surfaceEdgeKey(first, second);
      const existing = edgeOwners.get(key);
      if (!existing) {
        edgeOwners.set(key, { owner, first, second });
        return;
      }
      if (existing.owner === owner) return;
      [existing.first, existing.second].forEach(([x, y, z]) => {
        const scale = (layout.innerRadius + 1.15) / Math.hypot(x, y, z);
        boundaryVertices.push(x * scale, y * scale, z * scale);
      });
    });
  }

  surfaceGeometry.dispose();
  const geometries = new Map<string, THREE.BufferGeometry>();
  sites.forEach((site, index) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(plateVertices[index], 3),
    );
    geometry.computeVertexNormals();
    geometries.set(site.id, geometry);
  });
  const boundaryGeometry = new THREE.BufferGeometry();
  boundaryGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(boundaryVertices, 3),
  );
  return { geometries, boundaryGeometry };
}

export function edgeCurve(start: THREE.Vector3, end: THREE.Vector3, key: string) {
  const bow = start.clone().normalize().cross(end.clone().normalize());
  if (bow.lengthSq() > 0.0001) {
    bow.normalize().multiplyScalar(hashValue(key) % 2 === 0 ? 16 : -16);
  }
  const firstControl = start.clone().multiplyScalar(1.42).add(bow);
  const secondControl = end.clone().multiplyScalar(0.78).addScaledVector(bow, 0.65);
  return new THREE.CubicBezierCurve3(start, firstControl, secondControl, end);
}

export function disposeScene(scene: THREE.Scene, textures: Iterable<THREE.Texture>) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    const values = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    values.forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  for (const texture of textures) texture.dispose();
}
