import { Check, CircleDashed, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DocumentStatus } from "@/lib/types";

const MAP: Record<
  DocumentStatus,
  {
    label: string;
    variant: "outline" | "secondary" | "success" | "destructive";
    icon: typeof Check;
    spin?: boolean;
  }
> = {
  pending: { label: "待处理", variant: "outline", icon: CircleDashed },
  loading: { label: "解析入库", variant: "secondary", icon: Loader2, spin: true },
  extracting: { label: "抽取中", variant: "secondary", icon: Loader2, spin: true },
  ready: { label: "就绪", variant: "success", icon: Check },
  failed: { label: "失败", variant: "destructive", icon: XCircle },
};

export function DocStatusBadge({ status }: { status: DocumentStatus }) {
  const c = MAP[status] ?? MAP.pending;
  const Icon = c.icon;
  return (
    <Badge variant={c.variant}>
      <Icon className={cn("size-3", c.spin && "animate-spin")} />
      {c.label}
    </Badge>
  );
}
