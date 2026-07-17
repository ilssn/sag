/**
 * SAG 桌面壳主进程（Electron，ADR-0023）。
 *
 * 职责：拉起并监督 FastAPI sidecar（ADR-0017）、注入运行时配置（ADR-0007）、
 * 关窗即隐藏的常驻生命周期与托盘（ADR-0005/0009）、单实例聚焦（ADR-0016）、
 * 自托管更新（ADR-0020）。业务 UI 完全复用 apps/web 静态导出（ADR-0006）。
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

import { registerIpc } from "./ipc";
import { initLogging, log } from "./logging";
import { loadPrefs } from "./prefs";
import { Supervisor } from "./supervisor";
import { createTray } from "./tray";
import { checkNow, initUpdater } from "./updater";
import {
  broadcastToWindows,
  createBootWindow,
  focusAnyWindow,
  registerAppScheme,
  serveAppProtocol,
  showBootWindow,
  showMainWindow,
} from "./window";

// ── 单实例（ADR-0016）：二次启动仅聚焦主实例 ──────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppScheme(); // 必须在 ready 之前

  let quitting = false;
  let supervisor: Supervisor | null = null;

  const requestQuit = () => {
    if (quitting) return;
    quitting = true;
    void (async () => {
      try {
        await supervisor?.quit();
      } finally {
        app.quit();
      }
    })();
  };

  app.on("second-instance", () => focusAnyWindow());

  app.whenReady().then(() => {
    initLogging();
    serveAppProtocol();

    // sidecar 数据根与 Electron 缓存分离（ADR-0012；Electron 会向 userData
    // 根写入 Cache/GPUCache 等运行垃圾，业务数据独立成 data/ 子目录）
    const dataDir = join(app.getPath("userData"), "data");
    mkdirSync(dataDir, { recursive: true });

    supervisor = new Supervisor({
      configDir: app.getPath("userData"),
      dataDir,
      resourcesPath: process.resourcesPath,
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      broadcast: (payload) => {
        broadcastToWindows("sag://startup", payload);
        broadcastToWindows("sag://sidecar-status", payload);
      },
      onReady: (port) => {
        const window = showMainWindow(port);
        // 关窗默认隐藏、服务常驻；偏好 closeToQuit 时走完整退出（ADR-0009）
        window.on("close", (event) => {
          if (quitting) return;
          if (loadPrefs(app.getPath("userData")).closeToQuit) {
            requestQuit();
            return;
          }
          event.preventDefault();
          window.hide();
        });
      },
      onTerminal: () => showBootWindow(),
    });

    registerIpc(supervisor, requestQuit);
    createTray(requestQuit);
    initUpdater(async () => {
      await supervisor?.quit();
    });
    createBootWindow();
    void supervisor.start();
    log("info", `数据目录：${dataDir}`);
  });

  // macOS Dock 点击重新打开
  app.on("activate", () => focusAnyWindow());

  // 全窗口关闭不退出：服务常驻，托盘是生命周期入口（ADR-0009）
  app.on("window-all-closed", () => {
    /* 保持运行 */
  });

  // Cmd+Q / OS 注销：先停 sidecar 再放行退出
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    requestQuit();
  });
}

export { checkNow }; // 供测试引用（避免 tree-shake 误报）
