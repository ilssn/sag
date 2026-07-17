/**
 * 自托管更新（ADR-0020/0023）：electron-updater + GitHub Releases。
 * 提示式安装 —— 就绪后 10 秒 + 每 24 小时 + 设置页手动检查；
 * 不做退出时静默安装（与 ADR-0009 常驻语义冲突）。
 */

import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

import { log } from "./logging";
import { loadPrefs } from "./prefs";

const FIRST_CHECK_DELAY_MS = 10_000;
const PERIODIC_CHECK_MS = 24 * 60 * 60 * 1000;

let installPrompted = false;

export function initUpdater(gracefulStopSidecar: () => Promise<void>): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (message: unknown) => log("info", `updater: ${String(message)}`),
    warn: (message: unknown) => log("warn", `updater: ${String(message)}`),
    error: (message: unknown) => log("error", `updater: ${String(message)}`),
    debug: () => undefined,
  } as typeof autoUpdater.logger;

  autoUpdater.on("update-available", (info) => {
    void promptInstall(info.version, gracefulStopSidecar);
  });

  if (!app.isPackaged) return; // dev 不做自动检查
  setTimeout(() => void periodicCheck(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void periodicCheck(), PERIODIC_CHECK_MS);
}

async function periodicCheck(): Promise<void> {
  const policy = loadPrefs(app.getPath("userData")).updatePolicy;
  if (policy === "manual") return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log("warn", `更新检查失败：${String(error)}`);
  }
}

/** 设置页手动检查：返回结果文案。 */
export async function checkNow(): Promise<string> {
  if (!app.isPackaged) return "开发模式不检查更新";
  const result = await autoUpdater.checkForUpdates();
  const version = result?.updateInfo?.version;
  if (version && version !== app.getVersion()) return `发现新版本 ${version}`;
  return "当前已是最新版本";
}

async function promptInstall(
  version: string,
  gracefulStopSidecar: () => Promise<void>,
): Promise<void> {
  if (installPrompted) return;
  installPrompted = true;
  try {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "发现新版本",
      message: `SAG ${version} 可用。现在更新吗？`,
      buttons: ["立即更新", "稍后"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    await autoUpdater.downloadUpdate();
    log("info", "更新下载完成，停止 sidecar 后安装重启");
    await gracefulStopSidecar();
    autoUpdater.quitAndInstall();
  } catch (error) {
    log("error", `更新安装失败：${String(error)}`);
  } finally {
    installPrompted = false;
  }
}
