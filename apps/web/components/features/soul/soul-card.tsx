import Link from "next/link";
import { Users } from "lucide-react";

import type { Soul } from "@/lib/types";

export function SoulCard({ soul }: { soul: Soul }) {
  const snippet = soul.persona?.system_prompt || soul.persona?.greeting || "尚未填写设定";
  const shared = soul.visibility === "workspace";
  return (
    <Link
      href={`/assistants/${soul.id}`}
      className="group flex flex-col rounded-lg border border-hairline bg-surface p-5 shadow-soft transition-all duration-150 ease-smooth hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-lift"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-gold-soft font-display text-lg font-semibold text-gold-strong">
          {soul.avatar || soul.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-lg font-medium leading-tight text-ink group-hover:text-gold-strong">
            {soul.name}
          </h3>
          {soul.origin === "book_entity" && (
            <span className="text-[11px] text-ink-faint">来自书中人物</span>
          )}
        </div>
        {shared && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/30 bg-gold-soft/60 px-2 py-0.5 text-[11px] font-medium text-gold-strong"
            title="团队共享助手"
          >
            <Users className="size-3" />
            团队
          </span>
        )}
      </div>
      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm text-ink-muted">{snippet}</p>
    </Link>
  );
}
