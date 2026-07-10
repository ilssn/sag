"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { usePetEnabled } from "@/components/features/pet";
import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { THEME_OPTIONS } from "@/lib/settings-config";

export function AppearanceSettings() {
  return (
    <SettingsSection title="界面偏好" description="主题和桌面辅助显示。">
      <SettingsRow title="主题" description="选择界面的明暗模式。" layout="inline">
        <ThemeSegment />
      </SettingsRow>
      <PetToggleRow />
    </SettingsSection>
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

function PetToggleRow() {
  const [enabled, setEnabled] = usePetEnabled();

  return (
    <SettingsRow
      title="桌面宠物"
      description="仅在桌面端显示右下角的可拖动快捷入口。"
      layout="inline"
    >
      <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="桌面宠物开关" />
    </SettingsRow>
  );
}
