#!/usr/bin/env node
/**
 * 组装桌面前端产物 dist-web/（ADR-0006/0007）：
 * 1. 复用 apps/web/out（已有则直接用；否则触发 `npm run build` 生成静态导出）
 * 2. 注入 splash/boot.html（壳的启动/恢复页）
 * 3. 断言产物内不含 config.json —— 桌面配置只允许经 preload contextBridge 注入,
 *    残留部署配置会让「注入缺失即硬失败」的保护形同虚设。
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const webRoot = resolve(desktopRoot, "..", "web");
const webOut = join(webRoot, "out");
const distWeb = join(desktopRoot, "dist-web");

if (!existsSync(join(webOut, "index.html"))) {
  console.log("[stage-frontend] apps/web/out 不存在，执行静态导出构建…");
  execSync("npm run build", { cwd: webRoot, stdio: "inherit" });
}
if (!existsSync(join(webOut, "index.html"))) {
  console.error("[stage-frontend] 构建后仍未找到 apps/web/out/index.html");
  process.exit(1);
}

rmSync(distWeb, { recursive: true, force: true });
cpSync(webOut, distWeb, { recursive: true });

// 桌面产物绝不携带部署配置（ADR-0007：Tauri origin 注入缺失必须硬失败）
const strayConfig = join(distWeb, "config.json");
if (existsSync(strayConfig)) {
  rmSync(strayConfig);
  console.log("[stage-frontend] 已移除产物中的 config.json（桌面配置仅经宿主注入）");
}

cpSync(join(desktopRoot, "splash", "boot.html"), join(distWeb, "boot.html"));

const size = (dir) => {
  let total = 0;
  const walk = (p) => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += statSync(full).size;
    }
  };
  try { walk(dir); } catch { /* 统计失败不阻断 */ }
  return total;
};
console.log(`[stage-frontend] dist-web 就绪（${Math.round(size(distWeb) / 1024 / 1024)} MB）`);
