"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Library, Search, Sparkles, Waypoints } from "lucide-react";

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
      <div className="max-w-[9rem] rounded-full border border-dashed border-violet-500/35 bg-violet-500/8 px-2.5 py-1 text-center text-[11px] font-medium text-violet-700 shadow-soft dark:text-violet-300">
        <span className="line-clamp-1">{d.label}</span>
      </div>
    );
  }

  const meta = KIND_META[d.kind];
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card shadow-soft transition-shadow",
        d.kind === "query" && "border-primary/30",
        d.kind === "source" && "border-sky-500/25",
        d.kind === "chunk" && "cursor-pointer border-emerald-500/25 hover:shadow-lift",
      )}
      style={{ width: meta.width }}
    >
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
  );
}

const nodeTypes = { sag: GraphNode };

function edgeOf(
  source: string,
  target: string,
  kind: "qs" | "sc" | "ce",
  i: number,
): Edge {
  const labels = { qs: "检索", sc: "命中", ce: "提及" };
  return {
    id: `e-${kind}-${i}`,
    source,
    target,
    type: "smoothstep",
    label: labels[kind],
    labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontWeight: 500 },
    labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.92 },
    labelBgPadding: [4, 6] as [number, number],
    labelBgBorderRadius: 4,
    markerEnd: kind === "ce" ? undefined : { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    style: {
      stroke:
        kind === "qs"
          ? "hsl(var(--primary) / 0.45)"
          : kind === "sc"
            ? "hsl(var(--foreground) / 0.22)"
            : "hsl(var(--foreground) / 0.18)",
      strokeWidth: kind === "qs" ? 1.75 : 1.25,
      strokeDasharray: kind === "ce" ? "5 4" : undefined,
    },
  };
}

function buildNetwork(
  query: string,
  results: Section[],
  entitiesBySource: Map<string, Entity[]>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "q",
      type: "sag",
      position: { x: 0, y: 0 },
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
  const sourceCount = Math.max(sources.length, 1);
  const tau = Math.PI * 2;

  sources.forEach(([sid, g], si) => {
    const sector = tau / sourceCount;
    const sectorStart = -Math.PI / 2 + si * sector;
    const sectorMid = sectorStart + sector / 2;

    const sourceId = `s:${sid}`;
    const sourceR = 210;
    nodes.push({
      id: sourceId,
      type: "sag",
      position: {
        x: Math.cos(sectorMid) * sourceR,
        y: Math.sin(sectorMid) * sourceR,
      },
      data: { label: g.name, kind: "source" },
    });
    edges.push(edgeOf("q", sourceId, "qs", edgeIdx++));

    const chunks = [...g.sections].sort((a, b) => b.score - a.score).slice(0, 8);
    const ents = entitiesBySource.get(sid) ?? [];
    const chunkR = 360;
    const innerPad = sector * 0.12;
    const usable = sector * 0.76;

    chunks.forEach((sec, ci) => {
      const t = chunks.length === 1 ? 0.5 : ci / (chunks.length - 1);
      const angle = sectorStart + innerPad + t * usable;
      const cid = `c:${sec.chunk_id ?? `${sid}-${ci}`}`;
      nodes.push({
        id: cid,
        type: "sag",
        position: {
          x: Math.cos(angle) * chunkR,
          y: Math.sin(angle) * chunkR,
        },
        data: {
          label: sec.heading || sec.content.slice(0, 48) || "片段",
          kind: "chunk",
          score: sec.score,
          section: sec,
        },
      });
      edges.push(edgeOf(sourceId, cid, "sc", edgeIdx++));

      let linked = 0;
      for (const e of ents) {
        if (linked >= 3) break;
        const name = (e.name || "").trim();
        if (name.length < 2 || !sec.content.includes(name)) continue;
        const eid = `e:${sid}:${name}`;
        if (!nodes.some((n) => n.id === eid)) {
          const entityR = 470;
          const spread = 0.1;
          const eAngle = angle + (linked - 1) * spread;
          nodes.push({
            id: eid,
            type: "sag",
            position: {
              x: Math.cos(eAngle) * entityR,
              y: Math.sin(eAngle) * entityR,
            },
            data: { label: name, kind: "entity" },
          });
        }
        edges.push(edgeOf(cid, eid, "ce", edgeIdx++));
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

function FitViewOnChange({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const { fitView } = useReactFlow();
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      fitView({ padding: 0.18, duration: 280, minZoom: 0.35, maxZoom: 1.1 });
    }, 60);
    return () => window.clearTimeout(t);
  }, [nodes, edges, fitView]);
  return null;
}

export default function SearchGraph({ query, results }: { query: string; results: Section[] }) {
  const { open } = useDetailPanel();
  const [entities, setEntities] = React.useState<Map<string, Entity[]>>(new Map());

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
    () => buildNetwork(query, results, entities),
    [query, results, entities],
  );

  return (
    <div className="relative h-[min(72vh,640px)] min-h-[480px] overflow-hidden rounded-lg border bg-card/40">
      <GraphLegend />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodeOrigin={[0.5, 0.5]}
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
        <FitViewOnChange nodes={nodes} edges={edges} />
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
