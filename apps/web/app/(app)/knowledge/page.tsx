"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { useApp } from "@/components/features/app-shell";
import { KnowledgeWorkspace } from "@/components/features/knowledge-workspace";
import { SourceDetailView } from "@/components/features/source-detail-view";
import { SOURCE_PARAM } from "@/lib/client-route";
import { Skeleton } from "@/components/ui/skeleton";

function KnowledgePageContent() {
  const params = useSearchParams();
  const sourceId = params.get(SOURCE_PARAM);
  const { appMode } = useApp();

  if (sourceId) return <SourceDetailView sourceId={sourceId} />;
  return <KnowledgeWorkspace variant="normal" active={appMode === "normal"} />;
}

export default function KnowledgePage() {
  return (
    <React.Suspense
      fallback={(
        <div className="flex flex-col gap-2 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-16" />
        </div>
      )}
    >
      <KnowledgePageContent />
    </React.Suspense>
  );
}
