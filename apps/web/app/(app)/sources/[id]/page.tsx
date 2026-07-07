"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, MessagesSquare, TriangleAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Doc, Source } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { DocumentList } from "@/components/features/document-list";
import { EmptyState } from "@/components/features/empty-state";
import { UploadZone } from "@/components/features/upload-zone";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const ACTIVE = ["pending", "loading", "extracting"];

export default function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { capabilities } = useApp();
  const [source, setSource] = React.useState<Source | null>(null);
  const [documents, setDocuments] = React.useState<Doc[] | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [s, d] = await Promise.all([api.getSource(id), api.listDocuments(id)]);
      setSource(s);
      setDocuments(d);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) router.replace("/sources");
    }
  }, [id, router]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const active = documents?.some((d) => ACTIVE.includes(d.status)) ?? false;
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [active, refresh]);

  async function deleteSource() {
    if (!window.confirm("确定删除该信源？其文档与检索数据将不可再访问。")) return;
    try {
      await api.deleteSource(id);
      toast.success("信源已删除");
      router.push("/sources");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline px-6 py-6 md:px-8">
        <div className="min-w-0">
          <Link
            href="/sources"
            className="mb-2 inline-flex items-center gap-1 text-xs text-ink-faint transition-colors hover:text-ink-muted"
          >
            <ArrowLeft className="size-3.5" />
            全部信源
          </Link>
          {source ? (
            <>
              <h1 className="font-display text-2xl font-medium tracking-tight text-ink">
                {source.name}
              </h1>
              <p className="mt-1.5 text-sm text-ink-muted">
                {source.document_count} 文档 · {source.chunk_count} 块 · {source.event_count} 事件
                {source.description ? ` · ${source.description}` : ""}
              </p>
            </>
          ) : (
            <Skeleton className="h-8 w-48" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="gold">
            <Link href={`/ask?source=${id}`}>
              <MessagesSquare className="size-4" />
              去问答
            </Link>
          </Button>
          <Button variant="ghost" size="icon" title="删除信源" onClick={deleteSource} className="text-ink-muted hover:text-danger">
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 md:p-8">
        {capabilities && !capabilities.llm_configured && (
          <div className="flex items-start gap-2.5 rounded-md border border-gold/30 bg-gold-soft px-4 py-3 text-sm text-gold-strong">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              尚未配置模型：文档仍可上传并解析入库，但<strong>事件抽取</strong>与
              <strong>问答</strong>需要在
              <Link href="/settings" className="underline underline-offset-2">
                设置
              </Link>
              中配置 LLM。
            </span>
          </div>
        )}

        <UploadZone sourceId={id} onUploaded={refresh} maxMb={capabilities?.max_upload_mb ?? 25} />

        <div>
          <h2 className="mb-3 text-sm font-medium text-ink-muted">
            文档 {documents ? `（${documents.length}）` : ""}
          </h2>
          {documents === null ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="还没有文档"
              description="上传文档后，muse 会自动解析、分块、向量化并抽取事件与实体。"
            />
          ) : (
            <DocumentList sourceId={id} documents={documents} onChange={refresh} />
          )}
        </div>
      </div>
    </>
  );
}
