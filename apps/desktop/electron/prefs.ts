/**
 * 壳侧偏好（shell-settings.json）。
 * 存壳侧而非 API 数据库：close_to_quit 与 port 在 sidecar 尚未存在/已崩溃时
 * 也必须可读，放 API 里会形成自举环（ADR-0009/0010）。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PREFS_FILE = "shell-settings.json";

export interface ShellPrefs {
  /** 本地服务端口；null = 默认 47240（ADR-0022）。 */
  port: number | null;
  /** true = 关窗即退出；默认关窗仅隐藏、服务常驻（ADR-0009）。 */
  closeToQuit: boolean;
  /** "prompt"（默认，提示式更新）| "manual"（仅手动检查）。 */
  updatePolicy: "prompt" | "manual";
}

export const DEFAULT_PREFS: ShellPrefs = {
  port: null,
  closeToQuit: false,
  updatePolicy: "prompt",
};

export function loadPrefs(configDir: string): ShellPrefs {
  try {
    const raw = JSON.parse(readFileSync(join(configDir, PREFS_FILE), "utf8")) as Partial<ShellPrefs>;
    return {
      port: typeof raw.port === "number" ? raw.port : null,
      closeToQuit: raw.closeToQuit === true,
      updatePolicy: raw.updatePolicy === "manual" ? "manual" : "prompt",
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(configDir: string, prefs: ShellPrefs): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, PREFS_FILE), JSON.stringify(prefs, null, 2) + "\n", "utf8");
}
