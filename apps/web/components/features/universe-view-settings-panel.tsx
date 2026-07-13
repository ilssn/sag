"use client";

import * as React from "react";
import { LockKeyhole, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  UNIVERSE_VIEW_LIMITS,
  normalizeUniverseViewPreferences,
  type UniverseEdgeDensity,
  type UniverseLabelDensity,
  type UniverseViewPreferences,
  type UniverseViewPriority,
} from "@/lib/universe-view-preferences";
import type { UniverseNodeKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface UniverseViewSettingsProps {
  preferences: UniverseViewPreferences;
  onChange: (preferences: UniverseViewPreferences) => void;
  onReset: () => void;
  entityCategories: string[];
}

const PRIORITY_OPTIONS: Array<{
  value: UniverseViewPriority;
  key: "balanced" | "events" | "entities";
}> = [
  { value: "balanced", key: "balanced" },
  { value: "events", key: "events" },
  { value: "entities", key: "entities" },
];

const LABEL_DENSITY_OPTIONS: Array<{
  value: UniverseLabelDensity;
  key: "low" | "balanced" | "high";
}> = [
  { value: "low", key: "low" },
  { value: "balanced", key: "balanced" },
  { value: "high", key: "high" },
];

const EDGE_DENSITY_OPTIONS: Array<{
  value: UniverseEdgeDensity;
  key: "focus" | "context" | "all";
}> = [
  { value: "focus", key: "focus" },
  { value: "context", key: "context" },
  { value: "all", key: "all" },
];

const NODE_KIND_ORDER: UniverseNodeKind[] = ["event", "entity"];

export function UniverseViewSettings({
  preferences,
  onChange,
  onReset,
  entityCategories,
}: UniverseViewSettingsProps) {
  const locale = useLocale();
  const t = useTranslations("GraphSettings");
  const normalized = React.useMemo(
    () => normalizeUniverseViewPreferences(preferences),
    [preferences],
  );
  const [draftMaxNodes, setDraftMaxNodes] = React.useState(normalized.maxNodes);

  React.useEffect(() => {
    setDraftMaxNodes(normalized.maxNodes);
  }, [normalized.maxNodes]);

  const availableCategories = React.useMemo(() => {
    const selected = normalized.entityCategories ?? [];
    return [...new Set([...entityCategories, ...selected]
      .map((category) => category.trim())
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, locale));
  }, [entityCategories, locale, normalized.entityCategories]);

  const emit = React.useCallback((patch: Partial<UniverseViewPreferences>) => {
    onChange(normalizeUniverseViewPreferences({ ...normalized, ...patch }));
  }, [normalized, onChange]);

  const toggleKind = React.useCallback((kind: UniverseNodeKind, checked: boolean) => {
    const next = new Set(normalized.visibleKinds);
    if (checked) next.add(kind);
    else if (next.size > 1) next.delete(kind);
    emit({ visibleKinds: NODE_KIND_ORDER.filter((item) => next.has(item)) });
  }, [emit, normalized.visibleKinds]);

  const toggleCategory = React.useCallback((category: string, checked: boolean) => {
    if (normalized.entityCategories === null) {
      if (!checked) {
        emit({ entityCategories: availableCategories.filter((item) => item !== category) });
      }
      return;
    }
    const next = new Set(normalized.entityCategories);
    if (checked) next.add(category);
    else next.delete(category);
    const selected = availableCategories.filter((item) => next.has(item));
    emit({
      entityCategories: selected.length === availableCategories.length ? null : selected,
    });
  }, [availableCategories, emit, normalized.entityCategories]);

  const entityKindVisible = normalized.visibleKinds.includes("entity");

  return (
    <div className="flex flex-col gap-6" data-settings-section="graph">
      <SettingsSection
        title={t("content.title")}
        description={t("content.description")}
      >
        <SettingsRow
          title={t("visible.title")}
          description={t("visible.description")}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["event", "event"],
              ["entity", "entity"],
            ] as const).map(([kind, key]) => {
              const checked = normalized.visibleKinds.includes(kind);
              const lastVisible = checked && normalized.visibleKinds.length === 1;
              return (
                <label
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                    checked ? "border-foreground/20 bg-muted/45" : "border-border",
                    lastVisible ? "cursor-default" : "cursor-pointer",
                  )}
                  key={kind}
                >
                  <Checkbox
                    checked={checked}
                    className="mt-0.5"
                    disabled={lastVisible}
                    onCheckedChange={(value) => toggleKind(kind, value === true)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t(`visible.${key}.label`)}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {t(`visible.${key}.description`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          title={t("priority.title")}
          description={t("priority.description")}
          layout="inline"
        >
          <Select
            onValueChange={(value: UniverseViewPriority) => emit({ priority: value })}
            value={normalized.priority}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label={t("priority.aria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex flex-col">
                    <span>{t(`priority.options.${option.key}.label`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(`priority.options.${option.key}.description`)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          title={t("entityTypes.title")}
          description={t("entityTypes.description")}
          className={cn(!entityKindVisible && "opacity-55")}
        >
          <div className="overflow-hidden rounded-lg border">
            <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-sm font-medium">
              <Checkbox
                checked={normalized.entityCategories === null}
                disabled={!entityKindVisible}
                onCheckedChange={(value) => {
                  if (value === true) emit({ entityCategories: null });
                  else emit({ entityCategories: [] });
                }}
              />
              {t("entityTypes.all")}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {availableCategories.length || t("entityTypes.none")}
              </span>
            </label>
            {availableCategories.length > 0 ? (
              <div className="grid max-h-48 overflow-y-auto py-1 sm:grid-cols-2">
                {availableCategories.map((category) => {
                  const checked = normalized.entityCategories === null
                    || normalized.entityCategories.includes(category);
                  return (
                    <label
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60"
                      key={category}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!entityKindVisible}
                        onCheckedChange={(value) => toggleCategory(category, value === true)}
                      />
                      <span className="min-w-0 truncate" title={category}>{category}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {t("entityTypes.emptyDescription")}
              </p>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("performance.title")}
        description={t("performance.description")}
      >
        <SettingsRow
          title={t("maxNodes.title")}
          description={t("maxNodes.description")}
        >
          <div className="space-y-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">{t("maxNodes.current")}</span>
              <span className="font-mono font-semibold tabular-nums">
                {draftMaxNodes}
              </span>
            </div>
            <Slider
              aria-label={t("maxNodes.aria")}
              max={UNIVERSE_VIEW_LIMITS.maxNodes.max}
              min={UNIVERSE_VIEW_LIMITS.maxNodes.min}
              onValueChange={([value]) => setDraftMaxNodes(value ?? normalized.maxNodes)}
              onValueCommit={([value]) => {
                if (value !== undefined) emit({ maxNodes: value });
              }}
              step={UNIVERSE_VIEW_LIMITS.maxNodes.step}
              value={[draftMaxNodes]}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{UNIVERSE_VIEW_LIMITS.maxNodes.min}</span>
              <span>{t("maxNodes.recommended", { count: UNIVERSE_VIEW_LIMITS.maxNodes.default })}</span>
              <span>{UNIVERSE_VIEW_LIMITS.maxNodes.max}</span>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title={t("density.title")}
          description={t("density.description")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              {t("density.labels")}
              <Select
                onValueChange={(value: UniverseLabelDensity) => emit({ labelDensity: value })}
                value={normalized.labelDensity}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LABEL_DENSITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(`density.labelOptions.${option.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              {t("density.edges")}
              <Select
                onValueChange={(value: UniverseEdgeDensity) => emit({ edgeDensity: value })}
                value={normalized.edgeDensity}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EDGE_DENSITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(`density.edgeOptions.${option.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("exploration.title")}
        description={t("exploration.description")}
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">
              {t("exploration.savedLocally")}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              <RotateCcw />
              {t("exploration.reset")}
            </Button>
          </div>
        }
      >
        <SettingsRow
          title={t("exploration.autoExpand.title")}
          description={t("exploration.autoExpand.description")}
          layout="inline"
        >
          <Switch
            checked={normalized.browseAutoExpand}
            onCheckedChange={(browseAutoExpand) => emit({ browseAutoExpand })}
            aria-label={t("exploration.autoExpand.aria")}
          />
        </SettingsRow>
        <div className="flex gap-3 border-t bg-amber-500/[0.06] p-4 text-sm sm:p-5">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="leading-5 text-muted-foreground">
            {t("exploration.searchLocked")}
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
