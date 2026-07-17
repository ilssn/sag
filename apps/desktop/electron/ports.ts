/** 端口选择（ADR-0010/0022）：固定公开默认端口，冲突显式修复，绝不静默漂移。 */

import { createServer } from "node:net";

/** 桌面默认端口（ADR-0022）；与 `sag_api/sidecar.py::DEFAULT_DESKTOP_PORT` 同步维护。 */
export const DEFAULT_PORT = 47240;

export const PORT_MIN = 1024;
export const PORT_MAX = 49151;

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= PORT_MIN && port <= PORT_MAX;
}

/** 预探测端口可绑定性。TOCTOU 由 sidecar 自身的 port-conflict 终态事件兜底。 */
export function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}
