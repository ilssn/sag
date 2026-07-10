"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Layers, LayoutGrid, List, Plus } from "lucide-react";

import { api } from "@/lib/api";
import type { Source } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { EmptyState } from "@/components/features/empty-state";
import { PageHeader } from "@/components/features/page-header";
import { SourceCard } from "@/components/features/source-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type View = "grid" | "list";

function SourceRow({ source, first }: { source: Source; first: boolean }) {
  return (
    <Link
      href={`/knowledge/${source.id}`}
      className={`flex items-center gap-3 px-4 py-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 ${first ? "" : "border-t"}`}
    >
      <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Layers className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{source.name}</div>
        {source.description && (
          <div className="truncate text-xs text-muted-foreground">{source.description}</div>
        )}
      </div>
      <div className="hidden shrink-0 items-center gap-4 text-xs tabular-nums text-muted-foreground sm:flex">
        <span>{source.document_count} 文档</span>
        <span>{source.chunk_count} 分块</span>
        <span>{source.event_count} 事件</span>
        <span>{relativeTime(source.updated_at)}</span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default function KnowledgePage() {
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [view, setView] = React.useState<View>("grid");

  React.useEffect(() => {
    const saved = window.localStorage.getItem("sag:knowledge-view");
    if (saved === "list") setView("list");
  }, []);
  const changeView = (v: View) => {
    setView(v);
    window.localStorage.setItem("sag:knowledge-view", v);
  };

  const load = React.useCallback(() => {
    api.listSources().then(setSources).catch(() => setSources([]));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        title="知识库"
        description="你的信息源：上传文档，自动解析入库，对话与搜索即刻可用。"
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => v && changeView(v as View)}
              aria-label="展示方式"
            >
              <ToggleGroupItem value="grid" aria-label="卡片视图">
                <LayoutGrid />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="列表视图">
                <List />
              </ToggleGroupItem>
            </ToggleGroup>
            <CreateSourceDialog
              onCreated={load}
              trigger={
                <Button size="icon" aria-label="新建信源" title="新建信源">
                  <Plus />
                </Button>
              }
            />
          </>
        }
      />

      <div>
        {sources === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[168px]" />
            ))}
          </div>
        ) : sources.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="还没有信源"
            description="新建一个信源并上传文档，SAG 会解析入库，让内容可被搜索与问答。"
            action={<CreateSourceDialog onCreated={load} />}
          />
        ) : view === "grid" ? (
          <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} onChanged={load} />
            ))}
          </div>
        ) : (
          <div className="animate-fade-in overflow-hidden rounded-lg border">
            {sources.map((s, i) => (
              <SourceRow key={s.id} source={s} first={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
