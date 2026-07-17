"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { chatHref } from "@/lib/client-route";
import { useApp } from "@/components/features/app-shell";
import { SearchPanel } from "@/components/features/search/search-panel";
import { Skeleton } from "@/components/ui/skeleton";

function SearchPageContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { appMode } = useApp();

  return (
    <SearchPanel
      active={appMode === "normal"}
      initialQuery={params.get("q")?.trim() ?? ""}
      initialSourceId={params.get("source")}
      showCancel
      onCancel={() => (window.history.length > 1 ? router.back() : router.push(chatHref()))}
    />
  );
}

export default function SearchPage() {
  return (
    <React.Suspense
      fallback={(
        <div className="p-6">
          <Skeleton className="h-12 rounded-lg" />
        </div>
      )}
    >
      <SearchPageContent />
    </React.Suspense>
  );
}
