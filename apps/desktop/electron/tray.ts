/** 托盘（ADR-0005/0009）：仅服务生命周期入口 —— 打开 SAG / 退出 SAG。 */

import { join } from "node:path";
import { Menu, Tray, app, nativeImage } from "electron";

import { focusAnyWindow } from "./window";

let tray: Tray | null = null; // 常驻引用防 GC

export function createTray(requestQuit: () => void): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "trayTemplate.png")
    : join(__dirname, "..", "build", "trayTemplate.png");
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  if (process.platform === "darwin") icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("SAG");
  const menu = Menu.buildFromTemplate([
    { label: "打开 SAG", click: () => focusAnyWindow() },
    { type: "separator" },
    { label: "退出 SAG", click: () => requestQuit() },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => focusAnyWindow()); // Windows 左键直接打开
}
