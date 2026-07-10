"use client";

import { ListFilter, Network, ScanSearch } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getSearchStrategy,
  isSearchStrategy,
  SEARCH_STRATEGIES,
  type SearchStrategy,
} from "@/lib/retrieval-config";

const STRATEGY_ICONS = {
  multi: Network,
  vector: ScanSearch,
  atomic: ListFilter,
} as const;

export function SearchStrategyControl({
  value,
  defaultValue,
  onValueChange,
}: {
  value: SearchStrategy;
  defaultValue: SearchStrategy;
  onValueChange: (value: SearchStrategy) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">检索模式</span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          默认：{getSearchStrategy(defaultValue).label}
        </span>
      </div>
      <TooltipProvider>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={value}
          onValueChange={(nextValue) => {
            if (isSearchStrategy(nextValue)) onValueChange(nextValue);
          }}
          aria-label="检索模式"
          data-testid="search-strategy"
          className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto"
        >
          {SEARCH_STRATEGIES.map((strategy) => {
            const Icon = STRATEGY_ICONS[strategy.value];
            return (
              <Tooltip key={strategy.value}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem
                    type="button"
                    value={strategy.value}
                    aria-label={strategy.label}
                    className="gap-1.5 px-2 text-xs sm:px-2.5"
                  >
                    <Icon />
                    {strategy.label}
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{strategy.description}</TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </TooltipProvider>
    </div>
  );
}
