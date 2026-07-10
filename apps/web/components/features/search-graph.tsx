"use client";

import * as React from "react";
import {
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Library, Search, Sparkles } from "lucide-react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import { api } from "@/lib/api";
import type { Entity, Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDetailPanel } from "@/components/features/detail-panel";
import {
  GRAPH_EDGE_TYPE,
  GraphCanvas,
  GraphHandles,
  GraphLegend,
  graphEdgeHandles,
  type GraphLayout,
  type GraphPoint,
} from "@/components/features/graph-canvas";

/**
 * 搜索结果网状图谱 —— 辐射分层布局：查询（中心）→ 信源 → 命中片段 → 实体。
 * React Flow 负责渲染与交互；布局为确定性极坐标扇区，避免力导参数与节点尺寸失配导致重叠。
 */

type Kind = "query" | "source" | "chunk" | "entity";

type GraphNodeData = {
  label: string;
  kind: Kind;
  score?: number;
  section?: Section;
};

/** 布局配置（集中可调）：多源=按命中数比例的全周扇区；单源=自信源向下半环发散。 */
const LAYOUT = {
  sourceR: 210,
  chunkR: 380,
  entityR: 500,
  minSector: 0.55, // rad，命中很少的源也保有的最小扇区
  single: { queryGap: 230, chunkR: 320, entityGap: 150, arcStartDeg: -15, arcEndDeg: 195 },
} as const;

const KIND_META: Record<
  Exclude<Kind, "entity">,
  { title: string; header: string; width: number; height: number }
> = {
  query: { title: "检索问题", header: "bg-primary text-primary-foreground", width: 220, height: 88 },
  source: { title: "信源", header: "bg-sky-500/12 text-sky-700 dark:text-sky-300", width: 168, height: 72 },
  chunk: {
    title: "命中片段",
    header: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    width: 200,
    height: 96,
  },
};

function GraphNode({ data }: NodeProps) {
  const d = data as GraphNodeData;

  if (d.kind === "entity") {
    return (
      <div className="relative max-w-[9rem] rounded-full border border-dashed border-violet-500/35 bg-violet-500/8 px-2.5 py-1 text-center text-[11px] font-medium text-violet-700 shadow-soft dark:text-violet-300">
        <GraphHandles />
        <span className="line-clamp-1">{d.label}</span>
      </div>
    );
  }

  const meta = KIND_META[d.kind];
  return (
    <div
      className={cn(
        "relative rounded-lg border bg-card shadow-soft transition-shadow",
        d.kind === "query" && "border-primary/30",
        d.kind === "source" && "border-sky-500/25",
        d.kind === "chunk" && "cursor-pointer border-emerald-500/25 hover:shadow-lift",
      )}
      style={{ width: meta.width }}
    >
      <GraphHandles />
      <div className="overflow-hidden rounded-[inherit]">
        <div className={cn("flex items-center gap-1 px-2 py-1 text-[10px] font-medium", meta.header)}>
          {d.kind === "query" && <Search className="size-3 shrink-0" />}
          {d.kind === "source" && <Library className="size-3 shrink-0" />}
          {d.kind === "chunk" && <Sparkles className="size-3 shrink-0" />}
          {meta.title}
        </div>
        <div className="px-2.5 py-2 text-xs leading-snug text-foreground">
          <span className={d.kind === "query" ? "line-clamp-2 font-medium" : "line-clamp-3"}>{d.label}</span>
          {d.kind === "chunk" && d.score != null && (
            <span className="mt-1.5 inline-block rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {d.score.toFixed(3)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { sag: GraphNode };

function edgeOf(
  source: string,
  target: string,
  kind: "qs" | "sc" | "ce",
  i: number,
  from: GraphPoint,
  to: GraphPoint,
  edgeType: "straight" | "smoothstep" = "straight",
): Edge {
  const labels = { qs: "检索", sc: "命中", ce: "提及" };
  return {
    id: `e-${kind}-${i}`,
    source,
    target,
    ...graphEdgeHandles(from, to),
    type: edgeType,
    label: labels[kind],
    labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontWeight: 500 },
    labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.92 },
    labelBgPadding: [4, 6] as [number, number],
    labelBgBorderRadius: 4,
    markerEnd: kind === "ce" ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    interactionWidth: 18,
    style: {
      stroke:
        kind === "qs"
          ? "hsl(var(--primary) / 0.68)"
          : kind === "sc"
            ? "hsl(var(--foreground) / 0.36)"
            : "hsl(var(--foreground) / 0.28)",
      strokeWidth: kind === "qs" ? 2.4 : kind === "sc" ? 1.8 : 1.5,
      strokeDasharray: kind === "ce" ? "5 4" : undefined,
    },
  };
}

type Grouped = { sid: string; name: string; chunks: Section[]; ents: Entity[] };

function groupResults(results: Section[], entitiesBySource: Map<string, Entity[]>): Grouped[] {
  const bySource = new Map<string, { name: string; sections: Section[] }>();
  for (const s of results) {
    const key = s.source_id ?? "unknown";
    const g = bySource.get(key) ?? { name: s.source_name ?? "信源", sections: [] };
    g.sections.push(s);
    bySource.set(key, g);
  }
  return [...bySource.entries()].map(([sid, g]) => {
    const seenIds = new Set<string>();
    const seenFps = new Set<string>();
    const chunks = [...g.sections]
      .sort((a, b) => b.score - a.score)
      .filter((sec) => {
        // 双保险：不同 chunk_id 但内容相同的重复段也拦下（引擎相邻段可能重复返回）
        const fp = `${sec.heading ?? ""}|${sec.content.slice(0, 100)}`;
        if (sec.chunk_id && seenIds.has(sec.chunk_id)) return false;
        if (seenFps.has(fp)) return false;
        if (sec.chunk_id) seenIds.add(sec.chunk_id);
        seenFps.add(fp);
        return true;
      })
      .slice(0, 8);
    return { sid, name: g.name, chunks, ents: entitiesBySource.get(sid) ?? [] };
  });
}

function chunkNode(sec: Section, id: string, position: GraphPoint): Node {
  return {
    id,
    type: "sag",
    position,
    data: {
      label: sec.heading || sec.content.slice(0, 48) || "片段",
      kind: "chunk",
      score: sec.score,
      section: sec,
    },
  };
}

/** 片段→实体连边（各布局共用；positionOf 决定新实体落点）。 */
function linkEntities(
  group: Grouped,
  sec: Section,
  cid: string,
  chunkPos: GraphPoint,
  nodes: Node[],
  edges: Edge[],
  nextIdx: () => number,
  positionOf: (linked: number) => GraphPoint,
  edgeType: "straight" | "smoothstep" = "straight",
) {
  let linked = 0;
  for (const e of group.ents) {
    if (linked >= 3) break;
    const name = (e.name || "").trim();
    if (name.length < 2 || !sec.content.includes(name)) continue;
    const eid = `e:${group.sid}:${name}`;
    const existing = nodes.find((n) => n.id === eid);
    if (existing) {
      edges.push(edgeOf(cid, eid, "ce", nextIdx(), chunkPos, existing.position, edgeType));
    } else {
      const pos = positionOf(linked);
      nodes.push({ id: eid, type: "sag", position: pos, data: { label: name, kind: "entity" } });
      edges.push(edgeOf(cid, eid, "ce", nextIdx(), chunkPos, pos, edgeType));
    }
    linked++;
  }
}

/** 辐射：信源等分角环形发散；单源=中心簇 + 片段全周环。 */
function buildRadial(query: string, groups: Grouped[]): { nodes: Node[]; edges: Edge[] } {
  const single = groups.length === 1;
  const tau = Math.PI * 2;
  // 单源：信源即圆心（查询悬于其上方）；多源：查询为圆心
  const q = single ? { x: 0, y: -LAYOUT.single.queryGap } : { x: 0, y: 0 };
  const nodes: Node[] = [{ id: "q", type: "sag", position: q, data: { label: query, kind: "query" } }];
  const edges: Edge[] = [];
  let idx = 0;
  const nextIdx = () => idx++;

  groups.forEach((g, gi) => {
    const sPos = single
      ? { x: 0, y: 0 }
      : (() => {
          const mid = -Math.PI / 2 + (gi + 0.5) * (tau / groups.length);
          return { x: Math.cos(mid) * LAYOUT.sourceR, y: Math.sin(mid) * LAYOUT.sourceR };
        })();
    const sid = `s:${g.sid}`;
    nodes.push({ id: sid, type: "sag", position: sPos, data: { label: g.name, kind: "source" } });
    edges.push(edgeOf("q", sid, "qs", nextIdx(), q, sPos));

    const n = g.chunks.length;
    g.chunks.forEach((sec, ci) => {
      const t = n === 1 ? 0.5 : ci / (n - 1);
      let angle: number;
      let center: GraphPoint;
      let radius: number;
      if (single) {
        // 开口朝上的弧环：片段仅分布于信源两侧与下方（扇贝形），上方空档留给查询
        const { arcStartDeg, arcEndDeg } = LAYOUT.single;
        angle = (Math.PI / 180) * (arcStartDeg + t * (arcEndDeg - arcStartDeg));
        center = sPos;
        radius = LAYOUT.single.chunkR;
      } else {
        const sector = tau / groups.length;
        const mid = -Math.PI / 2 + (gi + 0.5) * sector;
        const spread = Math.min(sector * 0.78, 0.18 * Math.max(n - 1, 1));
        angle = mid + (t - 0.5) * spread;
        center = { x: 0, y: 0 };
        radius = LAYOUT.chunkR;
      }
      const cPos = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      const cid = `c:${sec.chunk_id ?? `${g.sid}-${ci}`}`;
      nodes.push(chunkNode(sec, cid, cPos));
      edges.push(edgeOf(sid, cid, "sc", nextIdx(), sPos, cPos));
      linkEntities(g, sec, cid, cPos, nodes, edges, nextIdx, (k) => {
        const ea = angle + (k - 1) * 0.09;
        const er = radius + LAYOUT.single.entityGap;
        return { x: center.x + Math.cos(ea) * er, y: center.y + Math.sin(ea) * er };
      });
    });
  });
  return { nodes, edges };
}

/** 层级：自上而下四层树（查询/信源/片段/实体），信源横坐标取其片段簇心。 */
function buildTree(query: string, groups: Grouped[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [{ id: "q", type: "sag", position: { x: 0, y: 0 }, data: { label: query, kind: "query" } }];
  const edges: Edge[] = [];
  let idx = 0;
  const nextIdx = () => idx++;
  const CHUNK_W = 224;
  const GROUP_GAP = 56;
  const totalW = groups.reduce((a, g) => a + g.chunks.length * CHUNK_W, 0) + GROUP_GAP * (groups.length - 1);
  let cursor = -totalW / 2;

  groups.forEach((g) => {
    const startX = cursor;
    const xs: number[] = [];
    g.chunks.forEach((_, ci) => xs.push(startX + ci * CHUNK_W + CHUNK_W / 2));
    cursor += g.chunks.length * CHUNK_W + GROUP_GAP;

    const sPos = { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: 190 };
    const sid = `s:${g.sid}`;
    nodes.push({ id: sid, type: "sag", position: sPos, data: { label: g.name, kind: "source" } });
    edges.push(edgeOf("q", sid, "qs", nextIdx(), { x: 0, y: 0 }, sPos, GRAPH_EDGE_TYPE.tree));

    g.chunks.forEach((sec, ci) => {
      const cPos = { x: xs[ci], y: 380 };
      const cid = `c:${sec.chunk_id ?? `${g.sid}-${ci}`}`;
      nodes.push(chunkNode(sec, cid, cPos));
      edges.push(edgeOf(sid, cid, "sc", nextIdx(), sPos, cPos, GRAPH_EDGE_TYPE.tree));
      linkEntities(g, sec, cid, cPos, nodes, edges, nextIdx, (k) => ({
        x: cPos.x + (k - 1) * 104,
        y: 545 + (k % 2) * 44,
      }), GRAPH_EDGE_TYPE.tree);
    });
  });
  return { nodes, edges };
}

function collisionRadius(kind: Kind): number {
  if (kind === "query") return 150;
  if (kind === "source") return 124;
  if (kind === "chunk") return 148;
  return 64;
}

/** 力导：以辐射为种子跑固定迭代，保留层次锚点，避免无约束坍缩成团。 */
function buildForce(query: string, groups: Grouped[]): { nodes: Node[]; edges: Edge[] } {
  const seed = buildRadial(query, groups);
  type SimNode = SimulationNodeDatum & { id: string; kind: Kind; anchorX: number; anchorY: number };
  const simNodes: SimNode[] = seed.nodes.map((n) => ({
    id: n.id,
    kind: (n.data as GraphNodeData).kind,
    x: n.position.x,
    y: n.position.y,
    anchorX: n.position.x,
    anchorY: n.position.y,
    ...(n.id === "q" ? { fx: n.position.x, fy: n.position.y } : {}),
  }));
  const simLinks: (SimulationLinkDatum<SimNode> & { kind: string })[] = seed.edges.map((e) => ({
    source: e.source,
    target: e.target,
    kind: e.id.split("-")[1] ?? "sc",
  }));
  const sim = forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((d) => d.id)
        .distance((l) => {
          const k = (l as { kind?: string }).kind;
          return k === "qs" ? 260 : k === "sc" ? 245 : 145;
        })
        .strength((l) => {
          const k = (l as { kind?: string }).kind;
          return k === "qs" ? 0.52 : k === "sc" ? 0.38 : 0.18;
        }),
    )
    .force("charge", forceManyBody().strength(-760))
    .force("collide", forceCollide<SimNode>((d) => collisionRadius(d.kind)).strength(0.9).iterations(3))
    .force("x", forceX<SimNode>((d) => d.anchorX).strength((d) => (d.kind === "entity" ? 0.04 : 0.09)))
    .force("y", forceY<SimNode>((d) => d.anchorY).strength((d) => (d.kind === "entity" ? 0.04 : 0.09)))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  const posOf = new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
  let edgeIdx = 0;
  return {
    nodes: seed.nodes.map((n) => ({ ...n, position: posOf.get(n.id) ?? n.position })),
    edges: seed.edges.map((e) => {
      const kind = (e.id.split("-")[1] as "qs" | "sc" | "ce") ?? "sc";
      const source = String(e.source);
      const target = String(e.target);
      return edgeOf(
        source,
        target,
        kind,
        edgeIdx++,
        posOf.get(source) ?? { x: 0, y: 0 },
        posOf.get(target) ?? { x: 0, y: 0 },
        GRAPH_EDGE_TYPE.force,
      );
    }),
  };
}

function buildNetwork(
  query: string,
  results: Section[],
  entitiesBySource: Map<string, Entity[]>,
  layout: GraphLayout,
): { nodes: Node[]; edges: Edge[] } {
  const groups = groupResults(results, entitiesBySource);
  if (layout === "tree") return buildTree(query, groups);
  if (layout === "force") return buildForce(query, groups);
  return buildRadial(query, groups);
}

export default function SearchGraph({ query, results }: { query: string; results: Section[] }) {
  const { open } = useDetailPanel();
  const [entities, setEntities] = React.useState<Map<string, Entity[]>>(new Map());
  const [layout, setLayout] = React.useState<GraphLayout>("radial");

  React.useEffect(() => {
    const saved = window.localStorage.getItem("sag:graph-layout");
    if (saved === "tree" || saved === "force") setLayout(saved);
  }, []);
  const changeLayout = (v: GraphLayout) => {
    setLayout(v);
    window.localStorage.setItem("sag:graph-layout", v);
  };

  React.useEffect(() => {
    let alive = true;
    const ids = [...new Set(results.map((r) => r.source_id).filter(Boolean))].slice(0, 4) as string[];
    Promise.all(
      ids.map((sid) =>
        api
          .listEntities(sid)
          .then((list) => [sid, list.slice(0, 24)] as const)
          .catch(() => [sid, [] as Entity[]] as const),
      ),
    ).then((pairs) => {
      if (alive) setEntities(new Map(pairs));
    });
    return () => {
      alive = false;
    };
  }, [results]);

  const { nodes, edges } = React.useMemo(
    () => buildNetwork(query, results, entities, layout),
    [query, results, entities, layout],
  );

  return (
    <GraphCanvas
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      layout={layout}
      onLayoutChange={changeLayout}
      legend={
        <GraphLegend
          items={[
            { label: "检索问题", className: "bg-primary" },
            { label: "信源", className: "bg-sky-500" },
            { label: "命中片段", className: "bg-emerald-500" },
            { label: "实体", className: "border border-dashed border-violet-500 bg-violet-500/20" },
          ]}
        />
      }
      heightClassName="h-full min-h-0"
      fitMinZoom={0.28}
      minZoom={0.2}
      maxZoom={1.6}
      refreshKey={results.length}
      ariaLabel="搜索结果图谱"
      flowClassName="sag-graph"
      onNodeClick={(_event, node) => {
        const d = node.data as GraphNodeData;
        if (d.kind === "chunk" && d.section?.chunk_id && d.section.source_id) {
          open({
            kind: "chunk",
            sourceId: d.section.source_id,
            chunkId: d.section.chunk_id,
            heading: d.section.heading ?? undefined,
            sourceName: d.section.source_name ?? undefined,
          });
        }
      }}
    />
  );
}
