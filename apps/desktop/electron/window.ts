/**
 * 窗口编排与 app:// 静态托管。
 *
 * 静态导出经自定义 `app://sag/` 协议托管（file:// 无法承载绝对路径资源，
 * 且需要稳定 origin 供后端 CORS 白名单，ADR-0023）。
 * 运行时配置以 additionalArguments → preload contextBridge 注入，
 * 先于一切页面脚本（ADR-0007）；本地访问密钥永不进渲染进程（ADR-0011）。
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, app, net, protocol } from "electron";

export const APP_SCHEME = "app";
export const APP_HOST = "sag";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

let mainWindow: BrowserWindow | null = null;
let bootWindow: BrowserWindow | null = null;

/** 必须在 app ready 之前调用。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function webRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "web")
    : join(__dirname, "..", "dist-web");
}

/** app ready 之后调用：app://sag/<path> → dist-web 文件（目录索引 + 404 回退）。 */
export function serveAppProtocol(): void {
  const root = webRoot();
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    if (pathname === "") pathname = "/index.html";
    // 路径遏制：解析后必须仍在 web 根内
    const resolved = normalize(join(root, pathname));
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      return new Response("forbidden", { status: 403 });
    }
    const candidates = [resolved, `${resolved}.html`, join(resolved, "index.html")];
    for (const candidate of candidates) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return net.fetch(pathToFileURL(candidate).toString());
      }
    }
    const notFound = join(root, "404.html");
    if (existsSync(notFound)) {
      return net.fetch(pathToFileURL(notFound).toString()).then(
        (response) => new Response(response.body, { status: 404, headers: response.headers }),
      );
    }
    return new Response("not found", { status: 404 });
  });
}

function preloadPath(): string {
  return join(__dirname, "preload.js");
}

export function createBootWindow(): BrowserWindow {
  if (bootWindow && !bootWindow.isDestroyed()) return bootWindow;
  bootWindow = new BrowserWindow({
    width: 460,
    height: 420,
    resizable: false,
    maximizable: false,
    title: "SAG",
    show: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  bootWindow.on("closed", () => {
    bootWindow = null;
  });
  void bootWindow.loadURL(`${APP_ORIGIN}/boot.html`);
  return bootWindow;
}

/** sidecar 就绪：以最终端口创建工作台窗口（配置经 additionalArguments 注入）并收起 boot。 */
export function showMainWindow(port: number): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    const runtimeConfig = {
      apiBase: `http://127.0.0.1:${port}`,
      host: "desktop",
      appVersion: app.getVersion(),
      flags: { enableWindowScaling: false },
    };
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      title: "SAG",
      show: false,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [`--sag-runtime-config=${JSON.stringify(runtimeConfig)}`],
      },
    });
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
  if (bootWindow && !bootWindow.isDestroyed()) bootWindow.close();
  return mainWindow;
}

/** 终态错误 / 崩溃循环时回到 boot 恢复页。 */
export function showBootWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
    mainWindow = null;
  }
  const window = createBootWindow();
  window.show();
  window.focus();
}

/** 显示并聚焦任一现存窗口（托盘「打开」/二次启动/Dock 激活共用）。 */
export function focusAnyWindow(): void {
  const target =
    (mainWindow && !mainWindow.isDestroyed() && mainWindow) ||
    (bootWindow && !bootWindow.isDestroyed() && bootWindow) ||
    null;
  if (target) {
    target.show();
    if (target.isMinimized()) target.restore();
    target.focus();
    return;
  }
  showBootWindow(); // 两个窗口都不在的边界:回到 boot 页兜底
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

export function broadcastToWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}
