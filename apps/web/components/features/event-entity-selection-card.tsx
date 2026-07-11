import { CalendarClock, Sparkles, Users } from "lucide-react";

import type { Entity, SourceGraphEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";

export type EventEntitySelection =
  | { kind: "event"; value: SourceGraphEvent }
  | { kind: "entity"; value: Entity };

function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(date);
}

export function EventEntitySelectionCard({
  selection,
  onOpenEvent,
}: {
  selection: EventEntitySelection;
  onOpenEvent?: (event: SourceGraphEvent) => void;
}) {
  if (selection.kind === "entity") {
    const entity = selection.value;
    return (
      <div className="absolute bottom-3 left-14 z-20 w-[min(22rem,calc(100%-5rem))] rounded-lg border bg-card/95 p-3 shadow-lift backdrop-blur-sm">
        <div className="flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
          <Users className="size-3.5" />
          {entity.type || "实体"}
        </div>
        <div className="mt-1 text-sm font-medium text-foreground">{entity.name}</div>
        {entity.description && (
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {entity.description}
          </p>
        )}
      </div>
    );
  }

  const event = selection.value;
  return (
    <div className="absolute bottom-3 left-14 z-20 w-[min(25rem,calc(100%-5rem))] rounded-lg border bg-card/95 p-3 shadow-lift backdrop-blur-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
        <Sparkles className="size-3.5" />
        {event.category || "事件"}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{event.title}</div>
      {event.summary && (
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {event.summary}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {event.start_time && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <CalendarClock className="size-3" />
            {formatEventDate(event.start_time)}
          </span>
        )}
        {event.chunk_id && onOpenEvent && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => onOpenEvent(event)}
          >
            查看原文
          </Button>
        )}
      </div>
    </div>
  );
}
