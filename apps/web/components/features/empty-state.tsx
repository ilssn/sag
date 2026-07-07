import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-surface/40 px-6 py-16 text-center">
      <div className="grid size-11 place-items-center rounded-full bg-surface-2 text-ink-faint">
        <Icon className="size-5" />
      </div>
      <div className="font-display text-lg text-ink">{title}</div>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
