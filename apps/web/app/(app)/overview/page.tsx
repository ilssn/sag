"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Layers, MessagesSquare, Network, Puzzle, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "@/lib/api";
import type { Source } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { EmptyState } from "@/components/features/empty-state";
import { PageHeader } from "@/components/features/page-header";
import { SourceCard } from "@/components/features/source-card";
import { Skeleton } from "@/components/ui/skeleton";

function StatTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4 shadow-soft">
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Icon className="size-4 text-gold-strong" />
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-medium tabular-nums text-ink">{value}</div>
    </div>
  );
}

export default function OverviewPage() {
  const { user, capabilities } = useApp();
  const [sources, setSources] = React.useState<Source[] | null>(null);

  const load = React.useCallback(() => {
    api.listSources().then(setSources).catch(() => setSources([]));
  }, []);
  React.useEffect(() => load(), [load]);

  const totals = React.useMemo(() => {
    const s = sources ?? [];
    return {
      sources: s.length,
      documents: s.reduce((a, x) => a + x.document_count, 0),
      chunks: s.reduce((a, x) => a + x.chunk_count, 0),
      events: s.reduce((a, x) => a + x.event_count, 0),
    };
  }, [sources]);

  const recent = (sources ?? []).slice(0, 3);

  return (
    <>
      <PageHeader title={`欢迎回来，${user?.name ?? ""}`} description="从信息源到知识问答。" />

      <div className="flex flex-col gap-6 p-6 md:p-8">
        {capabilities && !capabilities.llm_configured && (
          <Link
            href="/settings"
            className="flex items-start gap-2.5 rounded-md border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-gold-strong transition-colors hover:border-gold/60"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>尚未配置模型。前往设置配置 LLM 后，即可进行事件抽取与问答。</span>
          </Link>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {sources === null
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
            : (
                <>
                  <StatTile icon={Layers} label="信源" value={totals.sources} />
                  <StatTile icon={FileText} label="文档" value={totals.documents} />
                  <StatTile icon={Puzzle} label="知识块" value={totals.chunks} />
                  <StatTile icon={Network} label="事件" value={totals.events} />
                </>
              )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-muted">最近信源</h2>
            <div className="flex items-center gap-2">
              {sources && sources.length > 0 && (
                <Link
                  href="/ask"
                  className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-gold-strong"
                >
                  <MessagesSquare className="size-4" />
                  去问答
                </Link>
              )}
              <Link href="/sources" className="text-sm text-ink-muted transition-colors hover:text-gold-strong">
                全部信源
              </Link>
            </div>
          </div>

          {sources === null ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[168px]" />
              ))}
            </div>
          ) : sources.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="开始使用 muse"
              description="创建第一个信源，上传文档，让知识可被检索与问答。"
              action={<CreateSourceDialog onCreated={load} />}
            />
          ) : (
            <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {recent.map((s) => (
                <SourceCard key={s.id} source={s} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
