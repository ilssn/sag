import { afterEach, describe, expect, it } from "vitest";

import {
  __setRuntimeConfigForTests,
  RuntimeConfigError,
  apiBase,
  defaultApiBase,
  isTauriHostOrigin,
  normalizeRuntimeConfig,
  runtimeConfig,
} from "./runtime-config";

const LOCALHOST = { protocol: "http:", hostname: "localhost" };

afterEach(() => {
  __setRuntimeConfigForTests(null);
});

describe("defaultApiBase", () => {
  it("本机访问回退 localhost:8000", () => {
    expect(defaultApiBase({ protocol: "http:", hostname: "localhost" })).toBe(
      "http://localhost:8000",
    );
    expect(defaultApiBase({ protocol: "http:", hostname: "127.0.0.1" })).toBe(
      "http://localhost:8000",
    );
  });

  it("局域网 IP 访问自动指向同主机 :8000", () => {
    expect(defaultApiBase({ protocol: "http:", hostname: "192.168.1.20" })).toBe(
      "http://192.168.1.20:8000",
    );
    expect(defaultApiBase({ protocol: "https:", hostname: "sag.internal" })).toBe(
      "https://sag.internal:8000",
    );
  });

  it("*.localhost（含 tauri.localhost）不做局域网改写", () => {
    expect(defaultApiBase({ protocol: "http:", hostname: "tauri.localhost" })).toBe(
      "http://localhost:8000",
    );
  });

  it("非 http(s) 协议（如 tauri:）不做局域网改写", () => {
    expect(defaultApiBase({ protocol: "tauri:", hostname: "localhost" })).toBe(
      "http://localhost:8000",
    );
  });
});

describe("isTauriHostOrigin", () => {
  it("识别 macOS 与 Windows 两种 Tauri origin", () => {
    expect(isTauriHostOrigin({ protocol: "tauri:", hostname: "localhost" })).toBe(true);
    expect(isTauriHostOrigin({ protocol: "http:", hostname: "tauri.localhost" })).toBe(true);
    expect(isTauriHostOrigin({ protocol: "https:", hostname: "tauri.localhost" })).toBe(true);
  });

  it("普通 web origin 不误判", () => {
    expect(isTauriHostOrigin(LOCALHOST)).toBe(false);
    expect(isTauriHostOrigin({ protocol: "https:", hostname: "sag.example.com" })).toBe(false);
  });
});

describe("normalizeRuntimeConfig", () => {
  it("完整配置原样归一，apiBase 去尾斜杠", () => {
    const config = normalizeRuntimeConfig(
      {
        apiBase: "http://127.0.0.1:47240/",
        host: "desktop",
        appVersion: "1.2.2",
        flags: { enableWindowScaling: false },
      },
      LOCALHOST,
    );
    expect(config.apiBase).toBe("http://127.0.0.1:47240");
    expect(config.enableWindowScaling).toBe(false);
    expect(config.host).toBe("desktop");
    expect(config.appVersion).toBe("1.2.2");
  });

  it("顶层 enableWindowScaling 与 flags 内写法均可，支持字符串开关", () => {
    expect(
      normalizeRuntimeConfig({ apiBase: "http://x:1", enableWindowScaling: "false" }, LOCALHOST)
        .enableWindowScaling,
    ).toBe(false);
    expect(
      normalizeRuntimeConfig({ apiBase: "http://x:1" }, LOCALHOST).enableWindowScaling,
    ).toBe(true);
  });

  it("apiBase 留空表示按部署主机推导", () => {
    const config = normalizeRuntimeConfig(
      { apiBase: "" },
      { protocol: "http:", hostname: "192.168.1.20" },
    );
    expect(config.apiBase).toBe("http://192.168.1.20:8000");
  });

  it("非法形态响亮失败", () => {
    expect(() => normalizeRuntimeConfig("oops", LOCALHOST)).toThrow(RuntimeConfigError);
    expect(() => normalizeRuntimeConfig(null, LOCALHOST)).toThrow(RuntimeConfigError);
    expect(() => normalizeRuntimeConfig([], LOCALHOST)).toThrow(RuntimeConfigError);
    expect(() => normalizeRuntimeConfig({ apiBase: 8000 }, LOCALHOST)).toThrow(
      RuntimeConfigError,
    );
  });
});

describe("runtimeConfig 访问纪律", () => {
  it("启动门完成前读取直接抛错（模块顶层求值即违规）", () => {
    expect(() => runtimeConfig()).toThrow(RuntimeConfigError);
    expect(() => apiBase()).toThrow(RuntimeConfigError);
  });

  it("测试注入后可读", () => {
    __setRuntimeConfigForTests({
      apiBase: "http://127.0.0.1:47240",
      enableWindowScaling: false,
    });
    expect(apiBase()).toBe("http://127.0.0.1:47240");
    expect(runtimeConfig().enableWindowScaling).toBe(false);
  });
});
