/** vitest 桩：为 logging 等模块提供无害的 electron 表面；未覆盖的访问一律抛错。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testLogRoot = mkdtempSync(join(tmpdir(), "sag-shell-logs-"));

function forbid(name: string): never {
  throw new Error(`单元测试不应访问 electron.${name}`);
}

export const app = {
  getPath: (_name: string) => testLogRoot,
  getVersion: () => "0.0.0-test",
  isPackaged: false,
};

export const ipcMain = new Proxy({}, { get: (_target, key) => forbid(`ipcMain.${String(key)}`) });
export default { app, ipcMain };
