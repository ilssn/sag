"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Layers, Network, Sparkles, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "@/lib/api";
import type { Soul, Source } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { CreateSoulDialog } from "@/components/features/soul/create-soul-dialog";
import { EmptyState } from "@/components/features/empty-state";
import { PageHeader } from "@/components/features/page-header";
import { SoulCard } from "@/components/features/soul/soul-card";
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

function SectionHeader({ title, href, hrefLabel }: { title: string; href: string; hrefLabel: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-medium text-ink-muted">{title}</h2>
      <Link href={href} className="text-sm text-ink-muted transition-colors hover:text-gold-strong">
        {hrefLabel}
      </Link>
    </div>
  );
}

export default function OverviewPage() {
  const { user, capabilities } = useApp();
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [souls, setSouls] = React.useState<Soul[] | null>(null);

  const load = React.useCallback(() => {
    api.listSources().then(setSources).catch(() => setSources([]));
    api.listSouls().then(setSouls).catch(() => setSouls([]));
  }, []);
  React.useEffect(() => load(), [load]);

  const totals = React.useMemo(() => {
    const s = sources ?? [];
    return {
      souls: (souls ?? []).length,
      sources: s.length,
      documents: s.reduce((a, x) => a + x.document_count, 0),
      events: s.reduce((a, x) => a + x.event_count, 0),
    };
  }, [sources, souls]);

  const loading = sources === null || souls === null;

  return (
    <>
      <PageHeader title={`欢迎回来，${user?.name ?? ""}`} description="接入知识，创建 Agent，带引用对话。" />

      <div className="flex flex-col gap-8 p-6 md:p-8">
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
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
          ) : (
            <>
              <StatTile icon={Sparkles} label="Agent" value={totals.souls} />
              <StatTile icon={Layers} label="知识库" value={totals.sources} />
              <StatTile icon={FileText} label="文档" value={totals.documents} />
              <StatTile icon={Network} label="事件" value={totals.events} />
            </>
          )}
        </div>

        <div>
          <SectionHeader title="我的 Agent" href="/souls" hrefLabel="全部 Agent" />
          {souls === null ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[132px]" />
              ))}
            </div>
          ) : souls.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="创建第一个 Agent"
              description="起个名字、写好设定，绑定你的知识库——它可以是你的助手、团队的决策脑，或书中的某个人物。"
              action={<CreateSoulDialog onCreated={load} />}
            />
          ) : (
            <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {souls.slice(0, 3).map((s) => (
                <SoulCard key={s.id} soul={s} />
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHeader title="最近知识库" href="/sources" hrefLabel="全部知识库" />
          {sources === null ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[168px]" />
              ))}
            </div>
          ) : sources.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="接入第一个知识库"
              description="上传文档或同步网页，muse 会解析入库、抽取事件，让知识可检索。"
              action={<CreateSourceDialog onCreated={load} />}
            />
          ) : (
            <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sources.slice(0, 3).map((s) => (
                <SourceCard key={s.id} source={s} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
