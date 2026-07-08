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

import type { Section } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDetailPanel } from "@/components/features/detail-panel";

/**
 * 搜索结果图谱 —— 查询(中心) → 信源(内环) → 命中片段(外环扇形)。
 * 确定性放射布局（无随机、无物理抖动）；片段节点按分数着色深浅，点击开右侧原文溯源。
 */

type GraphNodeData = {
  label: string;
  kind: "query" | "source" | "chunk";
  score?: number;
  section?: Section;
};

function GraphNode({ data }: NodeProps) {
  const d = data as GraphNodeData;
  return (
    <div
      className={cn(
        "max-w-44 rounded-md border px-2.5 py-1.5 text-xs leading-snug shadow-soft transition-shadow",
        d.kind === "query" && "border-transparent bg-primary font-medium text-primary-foreground",
        d.kind === "source" && "bg-card font-medium",
        d.kind === "chunk" && "cursor-pointer bg-card hover:shadow-lift",
      )}
      style={
        d.kind === "chunk" && d.score != null
          ? { borderColor: `hsl(var(--primary) / ${Math.min(0.9, Math.max(0.15, d.score))})` }
          : undefined
      }
    >
      <span className="line-clamp-2">{d.label}</span>
      {d.kind === "chunk" && d.score != null && (
        <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">
          {d.score.toFixed(3)}
        </span>
      )}
    </div>
  );
}

const nodeTypes = { sag: GraphNode };

function buildGraph(query: string, results: Section[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "q",
      type: "sag",
      position: { x: 0, y: 0 },
      data: { label: query, kind: "query" } satisfies GraphNodeData,
    },
  ];
  const edges: Edge[] = [];

  // 按信源分组
  const bySource = new Map<string, { name: string; sections: Section[] }>();
  for (const s of results) {
    const key = s.source_id ?? "unknown";
    const g = bySource.get(key) ?? { name: s.source_name ?? "信源", sections: [] };
    g.sections.push(s);
    bySource.set(key, g);
  }

  const groups = [...bySource.entries()];
  const R1 = 240; // 信源环
  const R2 = 210; // 片段相对其信源的扇形半径
  groups.forEach(([sid, g], gi) => {
    // 信源均匀分布在内环
    const angle = (gi / groups.length) * Math.PI * 2 - Math.PI / 2;
    const sx = Math.cos(angle) * R1;
    const sy = Math.sin(angle) * R1;
    const sourceId = `s:${sid}`;
    nodes.push({
      id: sourceId,
      type: "sag",
      position: { x: sx, y: sy },
      data: { label: g.name, kind: "source" } satisfies GraphNodeData,
    });
    edges.push({
      id: `e:q-${sid}`,
      source: "q",
      target: sourceId,
      style: { strokeOpacity: 0.5 },
    });

    // 片段沿信源外侧扇形展开（±60°）
    const n = g.sections.length;
    g.sections.forEach((sec, i) => {
      const spread = Math.PI / 1.5;
      const a = angle + (n === 1 ? 0 : (i / (n - 1) - 0.5) * spread);
      const cx = sx + Math.cos(a) * R2;
      const cy = sy + Math.sin(a) * R2;
      const cid = `c:${sec.chunk_id ?? `${gi}-${i}`}`;
      nodes.push({
        id: cid,
        type: "sag",
        position: { x: cx, y: cy },
        data: {
          label: sec.heading || sec.content.slice(0, 40) || "片段",
          kind: "chunk",
          score: sec.score,
          section: sec,
        } satisfies GraphNodeData,
      });
      edges.push({
        id: `e:${sourceId}-${cid}`,
        source: sourceId,
        target: cid,
        style: { strokeOpacity: 0.3 },
      });
    });
  });

  return { nodes, edges };
}

export default function SearchGraph({
  query,
  results,
}: {
  query: string;
  results: Section[];
}) {
  const { open } = useDetailPanel();
  const { nodes, edges } = React.useMemo(() => buildGraph(query, results), [query, results]);

  return (
    <div className="h-[560px] overflow-hidden rounded-lg border bg-card/40">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
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
        className="[&_.react-flow\_\_edge-path]:!stroke-border"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-transparent" />
        <Controls showInteractive={false} className="!shadow-soft" />
      </ReactFlow>
    </div>
  );
}
