"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, FlaskConical, Search, TriangleAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import type { Doc, Source } from "@/lib/types";
import { useApp } from "@/components/features/app-shell";
import { DocumentList } from "@/components/features/document-list";
import { EmptyState } from "@/components/features/empty-state";
import { RetrievalTestDialog } from "@/components/features/retrieval-test-dialog";
import { SourceMcpCard } from "@/components/features/source-mcp-card";
import { SyncPanel } from "@/components/features/sync-panel";
import { UploadZone } from "@/components/features/upload-zone";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
      if (err instanceof ApiError && err.status === 404) router.replace("/knowledge");
    }
  }, [id, router]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const active = documents?.some((d) => ACTIVE.includes(d.status)) ?? false;
  React.useEffect(() => {
    if (!active) return;
    let t: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (document.hidden) return;
      refresh();
    };
    t = setInterval(tick, 4000);
    return () => {
      if (t) clearInterval(t);
    };
  }, [active, refresh]);

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [retrievalOpen, setRetrievalOpen] = React.useState(false);

  async function deleteSource() {
    try {
      await api.deleteSource(id);
      toast.success("信源已删除");
      router.push("/knowledge");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-4 py-5 md:px-6">
        <div className="min-w-0">
          <Link
            href="/knowledge"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            全部信源
          </Link>
          {source ? (
            <>
              <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {source.name}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {source.document_count} 文档 · {source.chunk_count} 块 · {source.event_count} 事件
                {source.description ? ` · ${source.description}` : ""}
              </p>
            </>
          ) : (
            <Skeleton className="h-8 w-48" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setRetrievalOpen(true)}
            disabled={!source}
            title="用真实查询验证召回效果"
          >
            <FlaskConical className="size-4" />
            检索测试
          </Button>
          <Button asChild>
            <Link href={source ? `/search?source=${source.id}` : "/search"}>
              <Search className="size-4" />
              搜索此信源
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="删除信源"
            onClick={() => setConfirmDelete(true)}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title="删除信源"
            description={`「${source?.name ?? ""}」及其文档、会话将被删除，检索数据不可再访问。此操作无法撤销。`}
            confirmLabel="删除信源"
            onConfirm={deleteSource}
          />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
        {capabilities && !capabilities.llm_configured && (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertTitle>尚未配置模型</AlertTitle>
            <AlertDescription>
              文档仍可上传并解析入库，但<strong>事件抽取</strong>与<strong>问答</strong>需要在
              <Link href="/settings" className="font-medium underline underline-offset-2">
                设置
              </Link>
              中配置 LLM。
            </AlertDescription>
          </Alert>
        )}

        {source &&
          (source.connector_kind === "file_upload" ? (
            <UploadZone
              sourceId={id}
              onUploaded={refresh}
              maxMb={capabilities?.max_upload_mb ?? 25}
              allowedExts={capabilities?.allowed_upload_exts}
            />
          ) : (
            <SyncPanel sourceId={id} onSynced={refresh} />
          ))}

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
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
              description="上传文档后，sag 会自动解析、分块、向量化并抽取事件与实体。"
            />
          ) : (
            <DocumentList sourceId={id} documents={documents} onChange={refresh} />
          )}
        </div>

        <SourceMcpCard sourceId={id} />
      </div>

      {source && (
        <RetrievalTestDialog
          sourceId={source.id}
          sourceName={source.name}
          open={retrievalOpen}
          onOpenChange={setRetrievalOpen}
        />
      )}
    </>
  );
}
