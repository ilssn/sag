"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, Search, TriangleAlert } from "lucide-react";

import { api } from "@/lib/api";
import type { Soul, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/components/features/app-shell";
import { useSearch } from "@/components/features/search-overlay";
import { CreateSourceDialog } from "@/components/features/create-source-dialog";
import { CreateSoulDialog } from "@/components/features/soul/create-soul-dialog";
import { SoulCard } from "@/components/features/soul/soul-card";
import { SourceCard } from "@/components/features/source-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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

/** 黄金路径：三步引导（未起步时替代统计与列表）。 */
function GoldenPath({
  hasSource,
  hasDoc,
  hasAssistant,
  onChanged,
}: {
  hasSource: boolean;
  hasDoc: boolean;
  hasAssistant: boolean;
  onChanged: () => void;
}) {
  const steps = [
    {
      done: hasSource && hasDoc,
      title: "新建信源，上传文档",
      desc: "zleap 会自动解析、分块并抽取事件。",
      action: <CreateSourceDialog onCreated={onChanged} />,
    },
    {
      done: hasAssistant,
      title: "创建助手，绑定信源",
      desc: "起个名字、写好设定，它就能依据你的内容作答。",
      action: <CreateSoulDialog onCreated={onChanged} />,
    },
    {
      done: false,
      title: "开始对话",
      desc: "回答带引用，可追溯到原文；越聊越有记忆。",
      action: (
        <Button asChild variant="outline">
          <Link href="/assistants">
            前往助手
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      ),
    },
  ];
  // 聚焦第一个未完成步骤
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-soft">
      {steps.map((s, i) => {
        const focus = i === current;
        return (
          <div
            key={s.title}
            className={cn(
              "flex flex-wrap items-center gap-4 px-5 py-4",
              i > 0 && "border-t border-hairline",
              focus && "bg-gold-soft/40",
            )}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full border text-[13px] font-semibold tabular-nums",
                s.done
                  ? "border-transparent bg-gold text-gold-foreground"
                  : focus
                    ? "border-gold text-gold-strong"
                    : "border-hairline text-ink-faint",
              )}
            >
              {s.done ? <Check className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "text-sm font-medium",
                  s.done ? "text-ink-muted line-through decoration-hairline" : "text-ink",
                )}
              >
                {s.title}
              </div>
              <div className="text-xs text-ink-muted">{s.desc}</div>
            </div>
            {focus && <div className="shrink-0">{s.action}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function OverviewPage() {
  const { user, capabilities } = useApp();
  const { openSearch } = useSearch();
  const [sources, setSources] = React.useState<Source[] | null>(null);
  const [souls, setSouls] = React.useState<Soul[] | null>(null);

  const load = React.useCallback(() => {
    api.listSources().then(setSources).catch(() => setSources([]));
    api.listSouls().then(setSouls).catch(() => setSouls([]));
  }, []);
  React.useEffect(() => load(), [load]);

  const loading = sources === null || souls === null;
  const totals = React.useMemo(() => {
    const s = sources ?? [];
    return {
      assistants: (souls ?? []).length,
      sources: s.length,
      documents: s.reduce((a, x) => a + x.document_count, 0),
      events: s.reduce((a, x) => a + x.event_count, 0),
    };
  }, [sources, souls]);

  const hasDoc = (sources ?? []).some((s) => s.document_count > 0);
  const onboarding = !loading && (totals.sources === 0 || !hasDoc || totals.assistants === 0);

  return (
    <>
      <div className="border-b border-hairline px-6 py-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-medium tracking-tight text-ink">
              {`欢迎回来，${user?.name ?? ""}`}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">上传信息，创建助手，带引用对话。</p>
          </div>
          {/* 搜索入口：样式如输入框，点击呼出浮层 */}
          <button
            onClick={() => openSearch()}
            className="flex h-9 w-full max-w-xs items-center gap-2.5 rounded-md border border-hairline bg-surface px-3 text-sm text-ink-faint shadow-soft transition-colors hover:border-ink-faint sm:w-72"
          >
            <Search className="size-4" />
            <span className="flex-1 text-left">搜索全部信源…</span>
            <kbd className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* 概况：一行内联数字（非卡片） */}
        {!loading && !onboarding && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-muted">
            <span>
              <b className="font-display text-base font-medium tabular-nums text-ink">{totals.assistants}</b> 助手
            </span>
            <span>
              <b className="font-display text-base font-medium tabular-nums text-ink">{totals.sources}</b> 信源
            </span>
            <span>
              <b className="font-display text-base font-medium tabular-nums text-ink">{totals.documents}</b> 文档
            </span>
            <span>
              <b className="font-display text-base font-medium tabular-nums text-ink">{totals.events}</b> 事件
            </span>
          </div>
        )}
      </div>

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

        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[180px]" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-[132px]" />
              ))}
            </div>
          </div>
        ) : onboarding ? (
          <div>
            <h2 className="mb-3 text-sm font-medium text-ink-muted">三步开始</h2>
            <GoldenPath
              hasSource={totals.sources > 0}
              hasDoc={hasDoc}
              hasAssistant={totals.assistants > 0}
              onChanged={load}
            />
          </div>
        ) : (
          <>
            <div>
              <SectionHeader title="我的助手" href="/assistants" hrefLabel="全部助手" />
              <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(souls ?? []).slice(0, 3).map((s) => (
                  <SoulCard key={s.id} soul={s} />
                ))}
              </div>
            </div>
            <div>
              <SectionHeader title="最近信源" href="/sources" hrefLabel="全部信源" />
              <div className="grid animate-fade-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(sources ?? []).slice(0, 3).map((s) => (
                  <SourceCard key={s.id} source={s} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
