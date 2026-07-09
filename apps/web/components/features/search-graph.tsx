"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Library, ListTree, Maximize2, Minimize2, Orbit, Search, Share2, Sparkles } from "lucide-react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

import { api } from "@/lib/api";
import type { Entity, Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDetailPanel } from "@/components/features/detail-panel";

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

type Point = { x: number; y: number };

/** 布局配置（集中可调）：多源=按命中数比例的全周扇区；单源=自信源向下半环发散。 */
const LAYOUT = {
  sourceR: 210,
  chunkR: 380,
  entityR: 500,
  minSector: 0.55, // rad，命中很少的源也保有的最小扇区
  single: { sourceY: 170, chunkR: 260, entityGap: 145, arcFrom: 0.16, arcTo: 0.84 },
} as const;
type Side = "top" | "right" | "bottom" | "left";

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

function GraphHandles() {
  const sides: { side: Side; position: Position }[] = [
    { side: "top", position: Position.Top },
    { side: "right", position: Position.Right },
    { side: "bottom", position: Position.Bottom },
    { side: "left", position: Position.Left },
  ];
  return (
    <>
      {sides.map(({ side, position }) => (
        <React.Fragment key={side}>
          <Handle
            id={`target-${side}`}
            type="target"
            position={position}
            isConnectable={false}
            className="!size-2 !border-0 !bg-transparent !opacity-0"
          />
          <Handle
            id={`source-${side}`}
            type="source"
            position={position}
            isConnectable={false}
            className="!size-2 !border-0 !bg-transparent !opacity-0"
          />
        </React.Fragment>
      ))}
    </>
  );
}

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

function sideFromVector(from: Point, to: Point): Side {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function oppositeSide(side: Side): Side {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  if (side === "left") return "right";
  return "left";
}

function edgeOf(
  source: string,
  target: string,
  kind: "qs" | "sc" | "ce",
  i: number,
  from: Point,
  to: Point,
): Edge {
  const labels = { qs: "检索", sc: "命中", ce: "提及" };
  const side = sideFromVector(from, to);
  return {
    id: `e-${kind}-${i}`,
    source,
    target,
    sourceHandle: `source-${side}`,
    targetHandle: `target-${oppositeSide(side)}`,
    type: "smoothstep",
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

type LayoutKind = "radial" | "tree" | "force";

type Grouped = { sid: string; name: string; chunks: Section[]; ents: Entity[] };

function groupResults(results: Section[], entitiesBySource: Map<string, Entity[]>): Grouped[] {
  const bySource = new Map<string, { name: string; sections: Section[] }>();
  for (const s of results) {
    const key = s.source_id ?? "unknown";
    const g = bySource.get(key) ?? { name: s.source_name ?? "信源", sections: [] };
    g.sections.push(s);
    bySource.set(key, g);
  }
  return [...bySource.entries()].map(([sid, g]) => ({
    sid,
    name: g.name,
    chunks: [...g.sections].sort((a, b) => b.score - a.score).slice(0, 8),
    ents: entitiesBySource.get(sid) ?? [],
  }));
}

function chunkNode(sec: Section, id: string, position: Point): Node {
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
  chunkPos: Point,
  nodes: Node[],
  edges: Edge[],
  nextIdx: () => number,
  positionOf: (linked: number) => Point,
) {
  let linked = 0;
  for (const e of group.ents) {
    if (linked >= 3) break;
    const name = (e.name || "").trim();
    if (name.length < 2 || !sec.content.includes(name)) continue;
    const eid = `e:${group.sid}:${name}`;
    const existing = nodes.find((n) => n.id === eid);
    if (existing) {
      edges.push(edgeOf(cid, eid, "ce", nextIdx(), chunkPos, existing.position));
    } else {
      const pos = positionOf(linked);
      nodes.push({ id: eid, type: "sag", position: pos, data: { label: name, kind: "entity" } });
      edges.push(edgeOf(cid, eid, "ce", nextIdx(), chunkPos, pos));
    }
    linked++;
  }
}

/** 辐射：信源等分角环形发散；单源=中心簇 + 片段全周环。 */
function buildRadial(query: string, groups: Grouped[]): { nodes: Node[]; edges: Edge[] } {
  const q = { x: 0, y: 0 };
  const nodes: Node[] = [{ id: "q", type: "sag", position: q, data: { label: query, kind: "query" } }];
  const edges: Edge[] = [];
  let idx = 0;
  const nextIdx = () => idx++;
  const tau = Math.PI * 2;
  const single = groups.length === 1;

  groups.forEach((g, gi) => {
    const sector = single ? tau : tau / groups.length;
    const mid = single ? Math.PI / 2 : -Math.PI / 2 + (gi + 0.5) * sector;
    const sPos = single
      ? { x: 0, y: LAYOUT.single.sourceY }
      : { x: Math.cos(mid) * LAYOUT.sourceR, y: Math.sin(mid) * LAYOUT.sourceR };
    const sid = `s:${g.sid}`;
    nodes.push({ id: sid, type: "sag", position: sPos, data: { label: g.name, kind: "source" } });
    edges.push(edgeOf("q", sid, "qs", nextIdx(), q, sPos));

    const n = g.chunks.length;
    // 片段绕各自信源方向的局部扇（多源），或绕中心全周（单源）
    const spread = single ? tau : Math.min(sector * 0.78, 0.18 * Math.max(n - 1, 1));
    g.chunks.forEach((sec, ci) => {
      const t = n === 1 ? 0.5 : ci / (n - 1);
      const angle = single ? -Math.PI / 2 + (ci / n) * tau : mid + (t - 0.5) * spread;
      const cPos = { x: Math.cos(angle) * LAYOUT.chunkR, y: Math.sin(angle) * LAYOUT.chunkR };
      const cid = `c:${sec.chunk_id ?? `${g.sid}-${ci}`}`;
      nodes.push(chunkNode(sec, cid, cPos));
      edges.push(edgeOf(sid, cid, "sc", nextIdx(), sPos, cPos));
      linkEntities(g, sec, cid, cPos, nodes, edges, nextIdx, (k) => {
        const ea = angle + (k - 1) * 0.09;
        return { x: Math.cos(ea) * LAYOUT.entityR, y: Math.sin(ea) * LAYOUT.entityR };
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
    edges.push(edgeOf("q", sid, "qs", nextIdx(), { x: 0, y: 0 }, sPos));

    g.chunks.forEach((sec, ci) => {
      const cPos = { x: xs[ci], y: 380 };
      const cid = `c:${sec.chunk_id ?? `${g.sid}-${ci}`}`;
      nodes.push(chunkNode(sec, cid, cPos));
      edges.push(edgeOf(sid, cid, "sc", nextIdx(), sPos, cPos));
      linkEntities(g, sec, cid, cPos, nodes, edges, nextIdx, (k) => ({
        x: cPos.x + (k - 1) * 104,
        y: 545 + (k % 2) * 44,
      }));
    });
  });
  return { nodes, edges };
}

/** 力导：以辐射为种子跑固定迭代（查询锚定中心），网状有机分布。 */
function buildForce(query: string, groups: Grouped[]): { nodes: Node[]; edges: Edge[] } {
  const seed = buildRadial(query, groups);
  type SimNode = SimulationNodeDatum & { id: string };
  const simNodes: SimNode[] = seed.nodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    ...(n.id === "q" ? { fx: 0, fy: 0 } : {}),
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
          return k === "qs" ? 190 : k === "sc" ? 150 : 110;
        })
        .strength(0.6),
    )
    .force("charge", forceManyBody().strength(-460))
    .force("collide", forceCollide(96))
    .force("center", forceCenter(0, 0))
    .stop();
  for (let i = 0; i < 220; i++) sim.tick();
  const posOf = new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
  return {
    nodes: seed.nodes.map((n) => ({ ...n, position: posOf.get(n.id) ?? n.position })),
    edges: seed.edges,
  };
}

function buildNetwork(
  query: string,
  results: Section[],
  entitiesBySource: Map<string, Entity[]>,
  layout: LayoutKind,
): { nodes: Node[]; edges: Edge[] } {
  const groups = groupResults(results, entitiesBySource);
  if (layout === "tree") return buildTree(query, groups);
  if (layout === "force") return buildForce(query, groups);
  return buildRadial(query, groups);
}

function GraphLegend() {
  const items = [
    { label: "检索问题", className: "bg-primary" },
    { label: "信源", className: "bg-sky-500" },
    { label: "命中片段", className: "bg-emerald-500" },
    { label: "实体", className: "border border-dashed border-violet-500 bg-violet-500/20" },
  ];
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-2 rounded-lg border bg-card/95 px-2.5 py-2 shadow-soft backdrop-blur-sm">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className={cn("size-2 rounded-full", item.className)} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function FitViewOnChange({
  nodes,
  edges,
  refreshKey,
}: {
  nodes: Node[];
  edges: Edge[];
  refreshKey: unknown;
}) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  React.useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return;
    let frame = 0;
    const timers: number[] = [];
    const runFit = (duration = 260) => {
      fitView({ padding: 0.2, duration, minZoom: 0.28, maxZoom: 1.05 });
    };
    frame = window.requestAnimationFrame(() => {
      runFit(0);
      timers.push(window.setTimeout(() => runFit(), 120));
      timers.push(window.setTimeout(() => runFit(), 360));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [nodesInitialized, nodes, edges, refreshKey, fitView]);
  return null;
}

export default function SearchGraph({ query, results }: { query: string; results: Section[] }) {
  const { open } = useDetailPanel();
  const [entities, setEntities] = React.useState<Map<string, Entity[]>>(new Map());
  const [expanded, setExpanded] = React.useState(false);
  const [layout, setLayout] = React.useState<LayoutKind>("radial");

  React.useEffect(() => {
    const saved = window.localStorage.getItem("sag:graph-layout");
    if (saved === "tree" || saved === "force") setLayout(saved);
  }, []);
  const changeLayout = (v: LayoutKind) => {
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

  React.useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const { nodes, edges } = React.useMemo(
    () => buildNetwork(query, results, entities, layout),
    [query, results, entities, layout],
  );

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card/40",
        expanded
          ? "fixed inset-4 z-50 min-h-0 bg-card shadow-lift"
          : "h-[calc(100vh-14rem)] min-h-[620px] max-h-[860px]",
      )}
    >
      <GraphLegend />
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={layout}
          onValueChange={(v) => v && changeLayout(v as LayoutKind)}
          aria-label="图谱布局"
          className="rounded-md bg-card/95 shadow-soft backdrop-blur-sm"
        >
          <ToggleGroupItem value="radial" aria-label="辐射布局" title="辐射">
            <Orbit />
          </ToggleGroupItem>
          <ToggleGroupItem value="tree" aria-label="层级布局" title="层级">
            <ListTree />
          </ToggleGroupItem>
          <ToggleGroupItem value="force" aria-label="力导布局" title="力导网状">
            <Share2 />
          </ToggleGroupItem>
        </ToggleGroup>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "退出图谱全屏" : "放大图谱"}
          className="grid size-8 place-items-center rounded-md border bg-card/95 text-muted-foreground shadow-soft outline-none backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.28, maxZoom: 1.05 }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_e, node) => {
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
        className="sag-graph"
      >
        <FitViewOnChange nodes={nodes} edges={edges} refreshKey={`${expanded}-${layout}`} />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} className="!bg-transparent" />
        <Controls showInteractive={false} className="!shadow-soft" />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-md border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-soft backdrop-blur-sm">
        {layout === "radial" ? <Orbit className="size-3" /> : layout === "tree" ? <ListTree className="size-3" /> : <Share2 className="size-3" />}
        {layout === "radial" ? "辐射布局" : layout === "tree" ? "层级布局" : "力导网状"}
      </div>
    </div>
  );
}
