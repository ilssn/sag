import {
  Bot,
  Cpu,
  Monitor,
  Moon,
  Orbit,
  Palette,
  Plug,
  Sun,
  UserRound,
} from "lucide-react";

export const SETTINGS_PAGE = {
  title: "设置",
  description: "管理账户、默认助手、模型连接、集成、界面和图谱偏好。",
} as const;

export const SETTINGS_TABS = [
  { value: "account", label: "账户", icon: UserRound },
  { value: "agent", label: "助手", icon: Bot },
  { value: "model", label: "模型", icon: Cpu },
  { value: "integrations", label: "集成", icon: Plug },
  { value: "appearance", label: "外观", icon: Palette },
  { value: "graph", label: "图谱", icon: Orbit },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["value"];

export function isSettingsTab(value: string | null): value is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.value === value);
}

export function resolveSettingsTab(value: string | null): SettingsTab {
  return isSettingsTab(value) ? value : "account";
}

/** Canonical URL used by full-size, mini and ambient settings entry points. */
export function settingsTabHref(tab: SettingsTab, section?: string) {
  const params = new URLSearchParams({ tab });
  if (section?.trim()) params.set("section", section.trim());
  return `/settings?${params.toString()}`;
}

export const THEME_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export const TIMEZONE_OPTIONS = [
  { value: "Asia/Shanghai", label: "北京时间 · Asia/Shanghai" },
  { value: "UTC", label: "协调世界时 · UTC" },
  { value: "Asia/Hong_Kong", label: "香港 · Asia/Hong_Kong" },
  { value: "Asia/Singapore", label: "新加坡 · Asia/Singapore" },
  { value: "Asia/Tokyo", label: "东京 · Asia/Tokyo" },
  { value: "Asia/Seoul", label: "首尔 · Asia/Seoul" },
  { value: "Asia/Dubai", label: "迪拜 · Asia/Dubai" },
  { value: "Europe/London", label: "伦敦 · Europe/London" },
  { value: "Europe/Berlin", label: "柏林 · Europe/Berlin" },
  { value: "America/New_York", label: "纽约 · America/New_York" },
  { value: "America/Chicago", label: "芝加哥 · America/Chicago" },
  { value: "America/Denver", label: "丹佛 · America/Denver" },
  { value: "America/Los_Angeles", label: "洛杉矶 · America/Los_Angeles" },
  { value: "Australia/Sydney", label: "悉尼 · Australia/Sydney" },
] as const;

export const ARCHIVED_THREADS_PAGE_SIZE = 5;
export const SIDEBAR_THREADS_PAGE_SIZE = 6;
