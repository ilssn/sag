"use client";

import * as React from "react";
import { LockKeyhole, RotateCcw } from "lucide-react";

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
  label: string;
  description: string;
}> = [
  { value: "balanced", label: "均衡展示", description: "事件和实体按工作集顺序展示" },
  { value: "events", label: "事件优先", description: "节点紧张时优先保留时间与事实" },
  { value: "entities", label: "实体优先", description: "节点紧张时优先保留人物、组织与概念" },
];

const LABEL_DENSITY_OPTIONS: Array<{
  value: UniverseLabelDensity;
  label: string;
}> = [
  { value: "low", label: "低 · 更清爽" },
  { value: "balanced", label: "均衡" },
  { value: "high", label: "高 · 更多信息" },
];

const EDGE_DENSITY_OPTIONS: Array<{
  value: UniverseEdgeDensity;
  label: string;
}> = [
  { value: "focus", label: "焦点 · 关键关系" },
  { value: "context", label: "上下文" },
  { value: "all", label: "全部关系" },
];

const NODE_KIND_ORDER: UniverseNodeKind[] = ["event", "entity"];

export function UniverseViewSettings({
  preferences,
  onChange,
  onReset,
  entityCategories,
}: UniverseViewSettingsProps) {
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
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
  }, [entityCategories, normalized.entityCategories]);

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
        title="图谱内容"
        description="决定画面中优先保留什么；筛选只改变展示，不删除知识数据。"
      >
        <SettingsRow
          title="显示内容"
          description="事件和实体至少保留一类，避免出现没有上下文的空画面。"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["event", "事件", "时间线、事实与发生的事情"],
              ["entity", "实体", "人物、组织、地点与概念"],
            ] as const).map(([kind, label, description]) => {
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
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          title="展示优先级"
          description="达到窗口节点上限时，优先类型会先进入可见工作集。"
          layout="inline"
        >
          <Select
            onValueChange={(value: UniverseViewPriority) => emit({ priority: value })}
            value={normalized.priority}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="图谱展示优先级">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex flex-col">
                    <span>{option.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          title="实体类型"
          description="只看关心的实体分类；新发现的分类会自动出现在这里。"
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
              全部类型
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {availableCategories.length || "暂无分类"}
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
                探索含实体的知识后，可用分类会自动同步到这里。
              </p>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="性能与密度"
        description="用有界工作集和自适应细节控制渲染成本，避免探索越久越卡。"
      >
        <SettingsRow
          title="窗口节点上限"
          description="新增节点超过上限后按先进先出移除旧节点；图谱策略上限仍会优先生效。"
        >
          <div className="space-y-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">当前上限</span>
              <span className="font-mono font-semibold tabular-nums">
                {draftMaxNodes}
              </span>
            </div>
            <Slider
              aria-label="窗口节点上限"
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
              <span>推荐 {UNIVERSE_VIEW_LIMITS.maxNodes.default}</span>
              <span>{UNIVERSE_VIEW_LIMITS.maxNodes.max}</span>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title="视觉密度"
          description="标签根据视口面积自适应，关系线根据当前焦点和预算裁剪。"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              标签密度
              <Select
                onValueChange={(value: UniverseLabelDensity) => emit({ labelDensity: value })}
                value={normalized.labelDensity}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LABEL_DENSITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              关系密度
              <Select
                onValueChange={(value: UniverseEdgeDensity) => emit({ edgeDensity: value })}
                value={normalized.edgeDensity}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EDGE_DENSITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="探索行为"
        description="普通浏览可按需渐进加载；搜索和问答结果始终锁定，防止滚动偏离目标。"
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-muted-foreground">
              设置会立即同步到当前图谱，并保存在本浏览器。
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onReset}>
              <RotateCcw />
              恢复默认
            </Button>
          </div>
        }
      >
        <SettingsRow
          title="随缩放渐进加载"
          description="仅在普通浏览达到高细节级别时继续加载时间线。关闭后只能点击节点探索。"
          layout="inline"
        >
          <Switch
            checked={normalized.browseAutoExpand}
            onCheckedChange={(browseAutoExpand) => emit({ browseAutoExpand })}
            aria-label="随缩放渐进加载"
          />
        </SettingsRow>
        <div className="flex gap-3 border-t bg-amber-500/[0.06] p-4 text-sm sm:p-5">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="leading-5 text-muted-foreground">
            搜索或问答生成的图谱不会因滚轮继续请求数据。滚轮只缩放当前结果，点击节点“探索更多”才会扩展。
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
