"use client";

import * as React from "react";
import { Layers } from "lucide-react";

import { api } from "@/lib/api";
import type { Source } from "@/lib/types";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { EmptyState } from "@/components/features/empty-state";
import { PageHeader } from "@/components/features/page-header";
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
    <>
      <PageHeader title="信源" description="装内容的地方：上传文档，自动解析入库，供助手与搜索使用。">
        <CreateSourceDialog onCreated={load} />
      </PageHeader>

      <div className="p-6 md:p-8">
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
    </>
  );
}
