import {
  Bot,
  Cpu,
  LibraryBig,
  Monitor,
  Moon,
  Palette,
  Plug,
  Sun,
  UserRound,
} from "lucide-react";

export const SETTINGS_PAGE = {
  title: "设置",
  description: "管理账户、默认助手、模型连接、知识库参数、集成和界面偏好。",
} as const;

export const SETTINGS_TABS = [
  { value: "account", label: "账户", icon: UserRound },
  { value: "agent", label: "助手", icon: Bot },
  { value: "model", label: "模型", icon: Cpu },
  { value: "knowledge", label: "知识库", icon: LibraryBig },
  { value: "integrations", label: "集成", icon: Plug },
  { value: "appearance", label: "外观", icon: Palette },
] as const;

export const THEME_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export const ARCHIVED_THREADS_PAGE_SIZE = 5;
export const SIDEBAR_THREADS_PAGE_SIZE = 6;
