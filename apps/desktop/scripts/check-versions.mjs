#!/usr/bin/env node
/**
 * 发布门禁：壳 / 前端 / 后端 / tauri.conf 四处版本必须一致（ADR-0020：
 * 单一应用版本覆盖全部组件；ready 握手按 app_version 拒绝错配安装）。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");

const read = (path) => readFileSync(join(repo, path), "utf8");
const versions = {
  "apps/desktop/package.json": JSON.parse(read("apps/desktop/package.json")).version,
  "apps/desktop/src-tauri/tauri.conf.json": JSON.parse(
    read("apps/desktop/src-tauri/tauri.conf.json"),
  ).version,
  "apps/web/package.json": JSON.parse(read("apps/web/package.json")).version,
  "apps/api/sag_api/__init__.py": /__version__\s*=\s*"([^"]+)"/.exec(
    read("apps/api/sag_api/__init__.py"),
  )?.[1],
};

const values = [...new Set(Object.values(versions))];
if (values.length !== 1 || !values[0]) {
  console.error("[check-versions] 版本不一致：");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "<未找到>"}`);
  }
  process.exit(1);
}
console.log(`[check-versions] 版本一致：${values[0]}`);
