/**
 * sidecar 监督器（ADR-0017）：拉起、协议解析、看门狗、重启策略。
 *
 * 状态机：port-check → spawning → starting{phase} → ready
 *   · post-ready 崩溃 → 重启 ≤3（2/8/30s 退避；健康 10 分钟后计数清零）
 *   · 终态错误码与显式退出 → 永不自动重启
 * 超时预算：spawn→start ≤30s；任意事件重置 60s 沉默看门狗；绝对上限 15min。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { log, pipeSidecarStderr } from "./logging";
import { DEFAULT_PORT, probePort } from "./ports";
import { loadPrefs } from "./prefs";
import { parseLine, PROTOCOL_VERSION, type SidecarEvent } from "./protocol";

const START_EVENT_TIMEOUT_MS = 30_000;
const SILENCE_WATCHDOG_MS = 60_000;
const ABSOLUTE_STARTUP_CAP_MS = 15 * 60_000;
const GRACEFUL_SHUTDOWN_MS = 10_000;
const MAX_RESTARTS = 3;
const RESTART_BACKOFF_MS = [2_000, 8_000, 30_000];
const HEALTHY_RESET_MS = 10 * 60_000;

/** 广播给 boot 页与前端的启动状态。 */
export interface BootPayload {
  state: "phase" | "error" | "ready";
  phase?: string;
  code?: string;
  message?: string;
  port?: number;
  current?: number;
  total?: number;
  attempt?: number;
}

export interface SupervisorHost {
  /** 应用配置目录（shell-settings.json 所在）。 */
  configDir: string;
  /** sidecar 数据根（--data-dir，ADR-0012）。 */
  dataDir: string;
  /** 冻结 sidecar 所在资源目录（打包后 process.resourcesPath）。 */
  resourcesPath: string;
  /** 壳版本（ready 握手校验，ADR-0020）。 */
  appVersion: string;
  isPackaged: boolean;
  /** 状态广播（boot 页事件 + 前端降级横幅）。 */
  broadcast(payload: BootPayload): void;
  /** sidecar 就绪：以最终端口换装工作台窗口。 */
  onReady(port: number): void;
  /** 终态失败：回到 boot 恢复页。 */
  onTerminal(): void;
}

type RunOutcome =
  | { kind: "quit" }
  | { kind: "crashed-after-ready" }
  | { kind: "failed"; code: string; message: string };

export class Supervisor {
  private host: SupervisorHost;
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: BootPayload = { state: "phase", phase: "starting" };
  private quitting = false;
  private restartAttempts = 0;
  private readySince: number | null = null;
  private running = false;

  constructor(host: SupervisorHost) {
    this.host = host;
  }

  currentStatus(): BootPayload {
    return { ...this.status };
  }

  isQuitting(): boolean {
    return this.quitting;
  }

  private broadcast(payload: BootPayload): void {
    this.status = payload;
    this.host.broadcast(payload);
  }

  private selectedPort(): number {
    return loadPrefs(this.host.configDir).port ?? DEFAULT_PORT;
  }

  /**
   * 解析 sidecar 可执行：打包后用资源目录 onedir（ADR-0019），
   * 开发态允许 SAG_SIDECAR_COMMAND 覆盖（默认 apps/api venv 直跑模块）。
   */
  private sidecarCommand(): { command: string; baseArgs: string[] } | { error: string } {
    if (!this.host.isPackaged) {
      const custom = process.env.SAG_SIDECAR_COMMAND;
      if (custom) {
        const [command, ...baseArgs] = custom.split(/\s+/);
        if (!command) return { error: "SAG_SIDECAR_COMMAND 为空" };
        return { command, baseArgs };
      }
      const repoPython = join(__dirname, "..", "..", "api", ".venv", "bin", "python");
      return { command: repoPython, baseArgs: ["-m", "sag_api"] };
    }
    const binary = process.platform === "win32" ? "sag-api.exe" : "sag-api";
    const path = join(this.host.resourcesPath, "sidecar", binary);
    if (!existsSync(path)) return { error: `未找到 sidecar：${path}` };
    return { command: path, baseArgs: [] };
  }

  /** 主启动流程（幂等防重入）。 */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.quitting) {
        const port = this.selectedPort();
        this.broadcast({ state: "phase", phase: "port-check" });
        if (!(await probePort(port))) {
          this.broadcast({
            state: "error",
            code: "port-conflict",
            message: `端口 ${port} 已被其他程序占用`,
            port,
          });
          this.host.onTerminal();
          return; // 终态：等待用户改端口后 retry
        }

        const outcome = await this.runUntilExit(port, randomUUID().replace(/-/g, ""));
        if (outcome.kind === "quit") return;
        if (outcome.kind === "failed") {
          this.broadcast({ state: "error", code: outcome.code, message: outcome.message });
          this.host.onTerminal();
          return; // 就绪前失败一律等待用户处置（重试/看日志/退出）
        }
        // crashed-after-ready → 退避重启
        if (this.readySince !== null && Date.now() - this.readySince >= HEALTHY_RESET_MS) {
          this.restartAttempts = 0;
        }
        this.restartAttempts += 1;
        if (this.restartAttempts > MAX_RESTARTS) {
          this.broadcast({
            state: "error",
            code: "crash-loop",
            message: "本地服务连续崩溃，已停止自动重启",
          });
          this.host.onTerminal();
          return;
        }
        const delay = RESTART_BACKOFF_MS[Math.min(this.restartAttempts - 1, 2)];
        log("warn", `sidecar 退出，${delay}ms 后重启（第 ${this.restartAttempts} 次）`);
        this.broadcast({ state: "phase", phase: "restarting", attempt: this.restartAttempts });
        await sleep(delay);
      }
    } finally {
      this.running = false;
    }
  }

  private runUntilExit(port: number, nonce: string): Promise<RunOutcome> {
    return new Promise((resolve) => {
      this.broadcast({ state: "phase", phase: "spawning" });

      const resolved = this.sidecarCommand();
      if ("error" in resolved) {
        resolve({ kind: "failed", code: "startup-failed", message: resolved.error });
        return;
      }

      const child = spawn(
        resolved.command,
        [
          ...resolved.baseArgs,
          "serve",
          "--data-dir",
          this.host.dataDir,
          "--port",
          String(port),
          "--nonce",
          nonce,
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: { ...process.env },
        },
      );
      this.child = child;
      pipeSidecarStderr(child.stderr);

      let settled = false;
      let ready = false;
      let seenAnyEvent = false;
      let watchdog: NodeJS.Timeout | null = null;
      const startedAt = Date.now();

      const settle = (outcome: RunOutcome) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        resolve(outcome);
      };

      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog);
        if (ready) return; // 运行期不做沉默看门狗（健康交由使用面反馈）
        const budget = seenAnyEvent ? SILENCE_WATCHDOG_MS : START_EVENT_TIMEOUT_MS;
        const remaining = Math.min(budget, ABSOLUTE_STARTUP_CAP_MS - (Date.now() - startedAt));
        watchdog = setTimeout(() => {
          log("error", "sidecar 启动看门狗超时");
          void this.shutdownProcess();
          settle({
            kind: "failed",
            code: "startup-timeout",
            message: seenAnyEvent ? "本地服务长时间无响应" : "本地服务未在 30 秒内发出启动事件",
          });
        }, Math.max(remaining, 0));
      };
      armWatchdog();

      child.on("error", (error) => {
        settle({ kind: "failed", code: "startup-failed", message: `无法启动本地服务：${error.message}` });
      });

      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const event = parseLine(line);
        if (!event) return;
        // 全部事件校验 nonce：端口被陌生进程占据时绝不误认（ADR-0017）
        if (event.nonce !== nonce) {
          log("warn", `事件 nonce 不匹配（忽略）：${event.event}`);
          return;
        }
        seenAnyEvent = true;
        if (!ready) armWatchdog();
        this.applyStartupEvent(event, port, {
          onReady: () => {
            ready = true;
            if (watchdog) clearTimeout(watchdog);
            this.readySince = Date.now();
            this.broadcast({ state: "ready", port });
            this.host.onReady(port);
          },
          onTerminal: (code, message) => {
            void this.shutdownProcess();
            settle({ kind: "failed", code, message });
          },
        });
      });

      child.on("exit", (code) => {
        this.child = null;
        if (this.quitting) {
          settle({ kind: "quit" });
          return;
        }
        if (ready) {
          log("warn", `sidecar 于就绪后退出（code=${code}）`);
          settle({ kind: "crashed-after-ready" });
          return;
        }
        settle({
          kind: "failed",
          code: "startup-failed",
          message: `本地服务在就绪前退出（code=${code}）`,
        });
      });
    });
  }

  private applyStartupEvent(
    event: SidecarEvent,
    port: number,
    hooks: { onReady: () => void; onTerminal: (code: string, message: string) => void },
  ): void {
    switch (event.event) {
      case "start":
        this.broadcast({ state: "phase", phase: "starting" });
        return;
      case "migration":
        this.broadcast({
          state: "phase",
          phase: "migrating",
          current: event.current,
          total: event.total,
        });
        return;
      case "engine-init":
        this.broadcast({ state: "phase", phase: "engine-init" });
        return;
      case "ready": {
        if (event.protocol !== PROTOCOL_VERSION) {
          hooks.onTerminal(
            "version-mismatch",
            `协议版本不匹配（sidecar=${event.protocol}，壳=${PROTOCOL_VERSION}）`,
          );
          return;
        }
        if (this.host.isPackaged && event.app_version !== this.host.appVersion) {
          hooks.onTerminal(
            "version-mismatch",
            `组件版本不一致（sidecar=${event.app_version}，壳=${this.host.appVersion}）`,
          );
          return;
        }
        log("info", `sidecar 就绪 port=${port} capabilities=${event.capabilities?.join(",")}`);
        hooks.onReady();
        return;
      }
      case "error": {
        // 就绪前错误一律交给用户处置；终态码仅影响 boot 页指引文案（ADR-0017）
        hooks.onTerminal(event.code ?? "startup-failed", event.message ?? "启动失败");
        return;
      }
      default:
        return; // 未知事件宽容忽略
    }
  }

  /** 优雅停机：关 stdin（后端主停机信号）→ SIGTERM → 限时 → SIGKILL。 */
  async shutdownProcess(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    try {
      child.stdin.end();
    } catch {
      /* stdin 已关 */
    }
    if (process.platform !== "win32") child.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
      sleep(GRACEFUL_SHUTDOWN_MS).then(() => false),
    ]);
    if (!exited) {
      log("warn", "sidecar 未在限时内退出，强制终止");
      child.kill("SIGKILL");
    } else {
      log("info", "sidecar 已优雅退出");
    }
  }

  /** 显式退出（托盘 Quit / Cmd+Q / OS 注销）。 */
  async quit(): Promise<void> {
    this.quitting = true;
    await this.shutdownProcess();
  }

  /** boot 页「重试」：清理旧进程后重跑启动流程。 */
  async retry(): Promise<void> {
    await this.shutdownProcess();
    this.restartAttempts = 0;
    this.readySince = null;
    void this.start();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
