"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { THEME_OPTIONS } from "@/lib/settings-config";

export function AppearanceSettings() {
  return (
    <SettingsSection title="界面主题" description="选择适合当前环境的明暗模式。">
      <SettingsRow title="主题模式" description="控制整个界面的明暗显示。" layout="inline">
        <ThemeSegment />
      </SettingsRow>
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
