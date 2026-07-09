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
import { Library, Maximize2, Minimize2, Search, Sparkles, Waypoints } from "lucide-react";

import { api } from "@/lib/api";
import type { Entity, Section } from "@/lib/types";
import { cn } from "@/lib/utils";
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

function buildNetwork(
  query: string,
  results: Section[],
  entitiesBySource: Map<string, Entity[]>,
): { nodes: Node[]; edges: Edge[] } {
  const queryPosition = { x: 0, y: 0 };
  const nodes: Node[] = [
    {
      id: "q",
      type: "sag",
      position: queryPosition,
      data: { label: query, kind: "query" },
    },
  ];
  const edges: Edge[] = [];
  let edgeIdx = 0;

  const bySource = new Map<string, { name: string; sections: Section[] }>();
  for (const s of results) {
    const key = s.source_id ?? "unknown";
    const g = bySource.get(key) ?? { name: s.source_name ?? "信源", sections: [] };
    g.sections.push(s);
    bySource.set(key, g);
  }

  const sources = [...bySource.entries()];
  const tau = Math.PI * 2;
  const totalChunks = sources.reduce((a, [, g]) => a + Math.min(g.sections.length, 8), 0) || 1;
  const singleSource = sources.length === 1;

  // 多源：扇区宽度 = 最小保障 + 按命中数比例分配剩余
  const reserved = LAYOUT.minSector * sources.length;
  const free = Math.max(0, tau - reserved);
  let cursor = -Math.PI / 2;

  sources.forEach(([sid, g]) => {
    const chunks = [...g.sections].sort((a, b) => b.score - a.score).slice(0, 8);
    const ents = entitiesBySource.get(sid) ?? [];
    const sourceId = `s:${sid}`;

    if (singleSource) {
      // 单源：查询(中心) → 信源(正下) → 片段沿下半环发散 → 实体再向外
      const sourcePosition = { x: 0, y: LAYOUT.single.sourceY };
      nodes.push({ id: sourceId, type: "sag", position: sourcePosition, data: { label: g.name, kind: "source" } });
      edges.push(edgeOf("q", sourceId, "qs", edgeIdx++, queryPosition, sourcePosition));

      chunks.forEach((sec, ci) => {
        const t = chunks.length === 1 ? 0.5 : ci / (chunks.length - 1);
        const angle = Math.PI * (LAYOUT.single.arcFrom + t * (LAYOUT.single.arcTo - LAYOUT.single.arcFrom));
        const chunkPosition = {
          x: sourcePosition.x + Math.cos(angle) * LAYOUT.single.chunkR,
          y: sourcePosition.y + Math.sin(angle) * LAYOUT.single.chunkR,
        };
        const cid = `c:${sec.chunk_id ?? `${sid}-${ci}`}`;
        nodes.push({
          id: cid,
          type: "sag",
          position: chunkPosition,
          data: { label: sec.heading || sec.content.slice(0, 48) || "片段", kind: "chunk", score: sec.score, section: sec },
        });
        edges.push(edgeOf(sourceId, cid, "sc", edgeIdx++, sourcePosition, chunkPosition));

        let linked = 0;
        for (const e of ents) {
          if (linked >= 3) break;
          const name = (e.name || "").trim();
          if (name.length < 2 || !sec.content.includes(name)) continue;
          const eid = `e:${sid}:${name}`;
          const existing = nodes.find((n) => n.id === eid);
          if (!existing) {
            const entityPosition = {
              x: chunkPosition.x + (linked - 1) * 96,
              y: chunkPosition.y + LAYOUT.single.entityGap,
            };
            nodes.push({ id: eid, type: "sag", position: entityPosition, data: { label: name, kind: "entity" } });
            edges.push(edgeOf(cid, eid, "ce", edgeIdx++, chunkPosition, entityPosition));
          } else {
            edges.push(edgeOf(cid, eid, "ce", edgeIdx++, chunkPosition, existing.position));
          }
          linked++;
        }
      });
      return;
    }

    const sector = LAYOUT.minSector + (free * Math.min(chunks.length, 8)) / totalChunks;
    const sectorStart = cursor;
    cursor += sector;
    const sectorMid = sectorStart + sector / 2;

    const sourcePosition = { x: Math.cos(sectorMid) * LAYOUT.sourceR, y: Math.sin(sectorMid) * LAYOUT.sourceR };
    nodes.push({ id: sourceId, type: "sag", position: sourcePosition, data: { label: g.name, kind: "source" } });
    edges.push(edgeOf("q", sourceId, "qs", edgeIdx++, queryPosition, sourcePosition));

    const innerPad = sector * 0.12;
    const usable = sector * 0.76;
    chunks.forEach((sec, ci) => {
      const t = chunks.length === 1 ? 0.5 : ci / (chunks.length - 1);
      const angle = sectorStart + innerPad + t * usable;
      const cid = `c:${sec.chunk_id ?? `${sid}-${ci}`}`;
      const chunkPosition = { x: Math.cos(angle) * LAYOUT.chunkR, y: Math.sin(angle) * LAYOUT.chunkR };
      nodes.push({
        id: cid,
        type: "sag",
        position: chunkPosition,
        data: { label: sec.heading || sec.content.slice(0, 48) || "片段", kind: "chunk", score: sec.score, section: sec },
      });
      edges.push(edgeOf(sourceId, cid, "sc", edgeIdx++, sourcePosition, chunkPosition));

      let linked = 0;
      for (const e of ents) {
        if (linked >= 3) break;
        const name = (e.name || "").trim();
        if (name.length < 2 || !sec.content.includes(name)) continue;
        const eid = `e:${sid}:${name}`;
        const existing = nodes.find((n) => n.id === eid);
        if (!existing) {
          const eAngle = angle + (linked - 1) * 0.09;
          const entityPosition = { x: Math.cos(eAngle) * LAYOUT.entityR, y: Math.sin(eAngle) * LAYOUT.entityR };
          nodes.push({ id: eid, type: "sag", position: entityPosition, data: { label: name, kind: "entity" } });
          edges.push(edgeOf(cid, eid, "ce", edgeIdx++, chunkPosition, entityPosition));
        } else {
          edges.push(edgeOf(cid, eid, "ce", edgeIdx++, chunkPosition, existing.position));
        }
        linked++;
      }
    });
  });

    return { nodes, edges };
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
    () => buildNetwork(query, results, entities),
    [query, results, entities],
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
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? "退出图谱全屏" : "放大图谱"}
        className="absolute right-3 top-3 z-20 grid size-8 place-items-center rounded-md border bg-card/95 text-muted-foreground shadow-soft outline-none backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
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
        <FitViewOnChange nodes={nodes} edges={edges} refreshKey={expanded} />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} className="!bg-transparent" />
        <Controls showInteractive={false} className="!shadow-soft" />
      </ReactFlow>
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-md border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-soft backdrop-blur-sm">
        <Waypoints className="size-3" />
        辐射布局
      </div>
    </div>
  );
}
