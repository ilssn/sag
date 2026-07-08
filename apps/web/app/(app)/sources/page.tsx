"use client";

import * as React from "react";
import { Layers } from "lucide-react";

import { api } from "@/lib/api";
import type { Source } from "@/lib/types";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { EmptyState } from "@/components/features/empty-state";
import { SourceCard } from "@/components/features/source-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SourcesPage() {
  const [sources, setSources] = React.useState<Source[] | null>(null);

  const load = React.useCallback(() => {
    api.listSources().then(setSources).catch(() => setSources([]));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold">信源</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            装内容的地方：上传文档，自动解析入库，供助手与搜索使用。
          </p>
        </div>
        <CreateSourceDialog onCreated={load} />
      </div>

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
            description="新建一个信源并上传文档，zleap 会解析入库，让内容可被搜索与问答。"
            action={<CreateSourceDialog onCreated={load} />}
          />
        ) : (
          <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
