/**
 * 监督器状态机（ADR-0017）：以 tests/fake_sidecar.py 驱动真实子进程。
 * 注：supervisor.ts 依赖 ./logging（import electron）——测试经 vitest alias
 * 以桩替换（vitest.config.ts），不触碰 Electron 运行时。
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PORT } from "./ports";
import { savePrefs } from "./prefs";
import type { BootPayload, SupervisorHost } from "./supervisor";
import { Supervisor } from "./supervisor";

const FAKE = join(__dirname, "..", "tests", "fake_sidecar.py");

interface Recorded {
  broadcasts: BootPayload[];
  readyPort: number | null;
  terminal: boolean;
}

function makeHost(configDir: string): { host: SupervisorHost; recorded: Recorded } {
  const recorded: Recorded = { broadcasts: [], readyPort: null, terminal: false };
  const host: SupervisorHost = {
    configDir,
    dataDir: join(configDir, "data"),
    resourcesPath: configDir,
    appVersion: "1.2.2",
    isPackaged: false,
    broadcast: (payload) => recorded.broadcasts.push(payload),
    onReady: (port) => {
      recorded.readyPort = port;
    },
    onTerminal: () => {
      recorded.terminal = true;
    },
  };
  return { host, recorded };
}

function waitFor(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error("waitFor 超时"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "sag-shell-test-"));
  // 避免与真实默认端口/其他用例冲突:每例随机高位端口
  savePrefs(configDir, {
    port: 20000 + Math.floor(Math.random() * 20000),
    closeToQuit: false,
    updatePolicy: "prompt",
  });
});

afterEach(() => {
  delete process.env.SAG_SIDECAR_COMMAND;
});

describe("Supervisor 状态机", () => {
  it("happy path：完整相位序列 → onReady(port)", async () => {
    process.env.SAG_SIDECAR_COMMAND = `python3 ${FAKE} happy`;
    const { host, recorded } = makeHost(configDir);
    const supervisor = new Supervisor(host);
    void supervisor.start();
    await waitFor(() => recorded.readyPort !== null);

    const phases = recorded.broadcasts.map((b) => b.phase ?? b.state);
    expect(phases).toContain("port-check");
    expect(phases).toContain("spawning");
    expect(phases).toContain("migrating");
    expect(phases).toContain("engine-init");
    expect(recorded.broadcasts.at(-1)?.state).toBe("ready");
    expect(supervisor.currentStatus().state).toBe("ready");
    await supervisor.quit();
  }, 40_000);

  it("sidecar 终态错误（migration-failed）→ onTerminal，状态含指引码", async () => {
    process.env.SAG_SIDECAR_COMMAND = `python3 ${FAKE} migrate-fail`;
    const { host, recorded } = makeHost(configDir);
    const supervisor = new Supervisor(host);
    void supervisor.start();
    await waitFor(() => recorded.terminal);

    const status = supervisor.currentStatus();
    expect(status.state).toBe("error");
    expect(status.code).toBe("migration-failed");
    expect(recorded.readyPort).toBeNull();
    await supervisor.quit();
  }, 40_000);

  it("就绪前进程崩溃 → startup-failed 终态（不自动重启）", async () => {
    process.env.SAG_SIDECAR_COMMAND = `python3 ${FAKE} crash-early`;
    const { host, recorded } = makeHost(configDir);
    const supervisor = new Supervisor(host);
    void supervisor.start();
    await waitFor(() => recorded.terminal);

    expect(supervisor.currentStatus().code).toBe("startup-failed");
    await supervisor.quit();
  }, 40_000);

  it("显式 quit 优雅收尾（stdin EOF 停机路径）", async () => {
    process.env.SAG_SIDECAR_COMMAND = `python3 ${FAKE} happy`;
    const { host, recorded } = makeHost(configDir);
    const supervisor = new Supervisor(host);
    void supervisor.start();
    await waitFor(() => recorded.readyPort !== null);
    await supervisor.quit();
    expect(supervisor.isQuitting()).toBe(true);
  }, 40_000);

  it("端口被占 → port-conflict 终态（预探测，不拉起进程）", async () => {
    const { createServer } = await import("node:net");
    const blocker = createServer();
    const port = await new Promise<number>((resolve) => {
      blocker.listen({ host: "127.0.0.1", port: 0 }, () => {
        resolve((blocker.address() as { port: number }).port);
      });
    });
    savePrefs(configDir, { port, closeToQuit: false, updatePolicy: "prompt" });
    process.env.SAG_SIDECAR_COMMAND = `python3 ${FAKE} happy`;

    const { host, recorded } = makeHost(configDir);
    const supervisor = new Supervisor(host);
    await supervisor.start();
    expect(recorded.terminal).toBe(true);
    expect(supervisor.currentStatus().code).toBe("port-conflict");
    expect(supervisor.currentStatus().port).toBe(port);
    blocker.close();
  }, 20_000);

  it("默认端口常量与后端契约一致（ADR-0022）", () => {
    expect(DEFAULT_PORT).toBe(47240);
  });
});
