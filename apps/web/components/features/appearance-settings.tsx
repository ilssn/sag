"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { useApp } from "@/components/features/app-shell";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { THEME_OPTIONS, TIMEZONE_OPTIONS } from "@/lib/settings-config";

export function AppearanceSettings() {
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="界面主题" description="选择适合当前环境的明暗模式。">
        <SettingsRow title="主题模式" description="控制整个界面的明暗显示。" layout="inline">
          <ThemeSegment />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="区域与时间"
        description="数据库统一使用 UTC，界面与 Agent 按这里的时区理解时间。"
      >
        <SettingsRow
          title="系统时区"
          description="默认使用北京时间；夏令时由 IANA 时区规则自动处理。"
          layout="inline"
        >
          <TimezoneSelect />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}

function TimezoneSelect() {
  const { timezone, updateTimezone } = useApp();
  const [saving, setSaving] = React.useState(false);
  const options = React.useMemo(
    () =>
      TIMEZONE_OPTIONS.some((option) => option.value === timezone)
        ? TIMEZONE_OPTIONS
        : [{ value: timezone, label: timezone }, ...TIMEZONE_OPTIONS],
    [timezone],
  );

  const changeTimezone = async (value: string) => {
    if (value === timezone || saving) return;
    setSaving(true);
    try {
      await updateTimezone(value);
      toast.success("时区已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "时区保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Select value={timezone} onValueChange={changeTimezone} disabled={saving}>
      <SelectTrigger className="w-full sm:w-72" aria-label="系统时区">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ThemeSegment() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const current = mounted ? (theme ?? "system") : "system";
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={current}
      onValueChange={(value) => value && setTheme(value)}
      aria-label="界面主题"
      className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          className="gap-1.5 px-3"
        >
          <Icon />
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
