/** 壳日志（logs/shell.log）与 sidecar stderr 落盘（logs/sidecar.log）。 */

import { createWriteStream, mkdirSync, WriteStream } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { app } from "electron";

let shellStream: WriteStream | null = null;

export function logDir(): string {
  // macOS: ~/Library/Logs/SAG；Windows/Linux 落 userData/logs
  try {
    return app.getPath("logs");
  } catch {
    const dir = join(app.getPath("userData"), "logs");
    return dir;
  }
}

export function initLogging(): void {
  const dir = logDir();
  mkdirSync(dir, { recursive: true });
  shellStream = createWriteStream(join(dir, "shell.log"), { flags: "a" });
  log("info", `SAG 桌面壳启动 v${app.getVersion()}`);
}

export function log(level: "info" | "warn" | "error", message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  shellStream?.write(line + "\n");
  if (level === "error") console.error(line);
  else if (!app.isPackaged) console.log(line);
}

/** sidecar stderr（人类日志通道）逐行落盘；stdout 专属 JSONL 协议。 */
export function pipeSidecarStderr(stderr: Readable): void {
  const stream = createWriteStream(join(logDir(), "sidecar.log"), { flags: "a" });
  const lines = createInterface({ input: stderr });
  lines.on("line", (line) => stream.write(line + "\n"));
  lines.on("close", () => stream.end());
}
