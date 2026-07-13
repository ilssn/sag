"use client";

import { useApp } from "@/components/features/app-shell";
import { KnowledgeWorkspace } from "@/components/features/knowledge-workspace";

export default function KnowledgePage() {
  const { panelMode } = useApp();
  return <KnowledgeWorkspace variant="normal" active={panelMode === "normal"} />;
}
