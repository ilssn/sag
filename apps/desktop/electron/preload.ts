/**
 * Preload（contextIsolation + sandbox）：
 * 1. 把主进程经 additionalArguments 传入的运行时配置在任何页面脚本之前
 *    暴露为 window.__SAG_RUNTIME_CONFIG__（ADR-0007 的注入契约）；
 * 2. 暴露最小 sagShell 桥（boot 页与设置页的特权操作走 IPC 白名单）。
 */

import { contextBridge, ipcRenderer } from "electron";

const CONFIG_ARG_PREFIX = "--sag-runtime-config=";

const configArg = process.argv.find((argument) => argument.startsWith(CONFIG_ARG_PREFIX));
if (configArg) {
  try {
    const config = JSON.parse(configArg.slice(CONFIG_ARG_PREFIX.length)) as unknown;
    contextBridge.exposeInMainWorld("__SAG_RUNTIME_CONFIG__", config);
  } catch {
    // 配置损坏时不暴露 —— 前端在桌面 origin 下会硬失败进 BootError（ADR-0007）
  }
}

const INVOKE_CHANNELS = new Set([
  "sag:boot-status",
  "sag:retry-startup",
  "sag:quit-app",
  "sag:open-logs",
  "sag:get-shell-prefs",
  "sag:set-shell-prefs",
  "sag:set-port-preference",
  "sag:check-for-updates",
]);

const EVENT_CHANNELS = new Set(["sag://startup", "sag://sidecar-status"]);

contextBridge.exposeInMainWorld("sagShell", {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`未知通道：${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: string, callback: (payload: unknown) => void): () => void {
    if (!EVENT_CHANNELS.has(channel)) return () => undefined;
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
