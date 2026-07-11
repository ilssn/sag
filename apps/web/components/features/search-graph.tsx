"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import type {
  Entity,
  SearchEvent,
  SourceGraphEvent,
  SourceGraphRelation,
  SourceGraphResponse,
} from "@/lib/types";
import { useDetailPanel } from "@/components/features/detail-panel";
import { EventEntityGraph } from "@/components/features/source-graph";
import { Skeleton } from "@/components/ui/skeleton";

const OrbitalEventEntityGraph = dynamic(
  () =>
    import("@/components/features/orbital-graph-3d").then(
      (module) => module.OrbitalEventEntityGraph,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full min-h-[520px]" />,
  },
);

export default function SearchGraph({
  events,
  entities,
  relations,
  mode = "2d",
}: {
  events: SearchEvent[];
  entities: Entity[];
  relations: SourceGraphRelation[];
  mode?: "2d" | "3d";
}) {
  const { open } = useDetailPanel();
  const eventsById = React.useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );
  const graph = React.useMemo<SourceGraphResponse>(
    () => ({
      documents: [],
      events,
      entities,
      relations,
      counts: {
        documents: 0,
        events: events.length,
        entities: entities.length,
        shown_documents: 0,
        shown_events: events.length,
        shown_entities: entities.length,
        shown_relations: relations.length,
      },
      truncated: false,
    }),
    [entities, events, relations],
  );

  const graphProps = {
    graph,
    refreshKey: `${events.length}-${relations.length}`,
    emptyTitle: "没有可展示的事件—实体关系",
    emptyDescription: "当前命中的事件尚未关联实体，可切回列表查看事件摘要。",
    onOpenEvent: (event: SourceGraphEvent) => {
      const result = eventsById.get(event.id);
      if (!result?.chunk_id || !result.source_id) return;
      open({
        kind: "chunk" as const,
        sourceId: result.source_id,
        chunkId: result.chunk_id,
        heading: result.title,
        sourceName: result.source_name ?? undefined,
      });
    },
  };

  if (mode === "3d") return <OrbitalEventEntityGraph {...graphProps} />;
  return <EventEntityGraph {...graphProps} />;
}
