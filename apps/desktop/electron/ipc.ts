/** IPC 命令面（preload 白名单的另一半）。 */

import { app, ipcMain, shell } from "electron";
import { join } from "node:path";

import { logDir } from "./logging";
import { isValidPort, PORT_MAX, PORT_MIN } from "./ports";
import { loadPrefs, savePrefs, type ShellPrefs } from "./prefs";
import type { Supervisor } from "./supervisor";
import { checkNow } from "./updater";

export function registerIpc(supervisor: Supervisor, requestQuit: () => void): void {
  const configDir = app.getPath("userData");

  ipcMain.handle("sag:boot-status", () => supervisor.currentStatus());

  ipcMain.handle("sag:retry-startup", () => {
    void supervisor.retry();
  });

  ipcMain.handle("sag:quit-app", () => {
    requestQuit();
  });

  ipcMain.handle("sag:open-logs", async () => {
    await shell.openPath(join(logDir()));
  });

  ipcMain.handle("sag:get-shell-prefs", () => loadPrefs(configDir));

  ipcMain.handle("sag:set-shell-prefs", (_event, next: ShellPrefs) => {
    if (next.port !== null && !isValidPort(next.port)) {
      throw new Error(`端口必须在 ${PORT_MIN}-${PORT_MAX} 范围内`);
    }
    savePrefs(configDir, {
      port: next.port ?? null,
      closeToQuit: next.closeToQuit === true,
      updatePolicy: next.updatePolicy === "manual" ? "manual" : "prompt",
    });
  });

  ipcMain.handle("sag:set-port-preference", (_event, payload: { port: number }) => {
    const port = Number(payload?.port);
    if (!isValidPort(port)) {
      throw new Error(`端口必须在 ${PORT_MIN}-${PORT_MAX} 范围内`);
    }
    const current = loadPrefs(configDir);
    savePrefs(configDir, { ...current, port });
  });

  ipcMain.handle("sag:check-for-updates", () => checkNow());
}
