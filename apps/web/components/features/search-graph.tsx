"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
import { useDetailPanel } from "@/components/features/detail-panel";

/**
 * 搜索结果网状图谱 —— 查询 / 信源 / 命中片段 / 实体 四类节点的力导布局。
 * 片段↔实体按内容命中交叉连接，呈现「多图谱拓展」；布局确定性（固定种子位置 + 固定迭代数）。
 */

type Kind = "query" | "source" | "chunk" | "entity";

type GraphNodeData = {
  label: string;
  kind: Kind;
  score?: number;
  section?: Section;
};

type SimNode = SimulationNodeDatum & { id: string; kind: Kind };

function GraphNode({ data }: NodeProps) {
  const d = data as GraphNodeData;
  return (
    <div
      className={cn(
        "max-w-44 rounded-md border px-2.5 py-1.5 text-xs leading-snug shadow-soft transition-shadow",
        d.kind === "query" && "border-transparent bg-primary font-medium text-primary-foreground",
        d.kind === "source" && "bg-card font-medium",
        d.kind === "chunk" && "cursor-pointer bg-card hover:shadow-lift",
        d.kind === "entity" &&
          "rounded-full border-dashed bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground",
      )}
      style={
        d.kind === "chunk" && d.score != null
          ? { borderColor: `hsl(var(--primary) / ${Math.min(0.9, Math.max(0.15, d.score))})` }
          : undefined
      }
    >
      <span className={d.kind === "entity" ? "line-clamp-1" : "line-clamp-2"}>{d.label}</span>
      {d.kind === "chunk" && d.score != null && (
        <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">
          {d.score.toFixed(3)}
        </span>
      )}
    </div>
  );
}

const nodeTypes = { sag: GraphNode };

function buildNetwork(
  query: string,
  results: Section[],
  entitiesBySource: Map<string, Entity[]>,
): { nodes: Node[]; edges: Edge[] } {
  const simNodes: SimNode[] = [{ id: "q", kind: "query" }];
  const simLinks: (SimulationLinkDatum<SimNode> & { kind: string })[] = [];
  const meta = new Map<string, GraphNodeData>([["q", { label: query, kind: "query" }]]);

  const bySource = new Map<string, { name: string; sections: Section[] }>();
  for (const s of results) {
    const key = s.source_id ?? "unknown";
    const g = bySource.get(key) ?? { name: s.source_name ?? "信源", sections: [] };
    g.sections.push(s);
    bySource.set(key, g);
  }

  bySource.forEach((g, sid) => {
    const sourceId = `s:${sid}`;
    simNodes.push({ id: sourceId, kind: "source" });
    meta.set(sourceId, { label: g.name, kind: "source" });
    simLinks.push({ source: "q", target: sourceId, kind: "qs" });

    const ents = entitiesBySource.get(sid) ?? [];
    g.sections.forEach((sec, i) => {
      const cid = `c:${sec.chunk_id ?? `${sid}-${i}`}`;
      simNodes.push({ id: cid, kind: "chunk" });
      meta.set(cid, {
        label: sec.heading || sec.content.slice(0, 40) || "片段",
        kind: "chunk",
        score: sec.score,
        section: sec,
      });
      simLinks.push({ source: sourceId, target: cid, kind: "sc" });

      // 片段 ↔ 实体：内容命中实体名（≥2 字），单片段至多 4 连
      let linked = 0;
      for (const e of ents) {
        if (linked >= 4) break;
        const name = (e.name || "").trim();
        if (name.length < 2 || !sec.content.includes(name)) continue;
        const eid = `e:${name}`;
        if (!meta.has(eid)) {
          simNodes.push({ id: eid, kind: "entity" });
          meta.set(eid, { label: name, kind: "entity" });
        }
        simLinks.push({ source: cid, target: eid, kind: "ce" });
        linked++;
      }
    });
  });

  // 确定性种子位置（黄金角同心圆），固定迭代力导 → 网状但可复现
  simNodes.forEach((n, i) => {
    const ring = n.kind === "query" ? 0 : n.kind === "source" ? 160 : n.kind === "chunk" ? 320 : 430;
    const angle = (i * 137.5 * Math.PI) / 180;
    n.x = Math.cos(angle) * ring;
    n.y = Math.sin(angle) * ring;
  });

  const sim = forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((d) => d.id)
        .distance((l) => {
          const k = (l as { kind?: string }).kind;
          return k === "qs" ? 150 : k === "sc" ? 100 : 70;
        })
        .strength(0.5),
    )
    .force("charge", forceManyBody().strength(-260))
    .force("collide", forceCollide(52))
    .force("center", forceCenter(0, 0))
    .stop();
  for (let i = 0; i < 240; i++) sim.tick();

  const nodes: Node[] = simNodes.map((n) => ({
    id: n.id,
    type: "sag",
    position: { x: n.x ?? 0, y: n.y ?? 0 },
    data: meta.get(n.id)!,
  }));
  const edges: Edge[] = simLinks.map((l, i) => {
    const s = typeof l.source === "object" ? (l.source as SimNode).id : String(l.source);
    const t = typeof l.target === "object" ? (l.target as SimNode).id : String(l.target);
    return {
      id: `e${i}`,
      source: s,
      target: t,
      type: "straight",
      style: { strokeOpacity: l.kind === "ce" ? 0.25 : l.kind === "sc" ? 0.35 : 0.5 },
    };
  });
  return { nodes, edges };
}

export default function SearchGraph({ query, results }: { query: string; results: Section[] }) {
  const { open } = useDetailPanel();
  const [entities, setEntities] = React.useState<Map<string, Entity[]>>(new Map());

  // 命中信源的热点实体（≤3 源 × 前 24），供片段↔实体交叉连接
  React.useEffect(() => {
    let alive = true;
    const ids = [...new Set(results.map((r) => r.source_id).filter(Boolean))].slice(0, 3) as string[];
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
    <div className="h-[560px] overflow-hidden rounded-lg border bg-card/40">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-transparent" />
        <Controls showInteractive={false} className="!shadow-soft" />
      </ReactFlow>
    </div>
  );
}
