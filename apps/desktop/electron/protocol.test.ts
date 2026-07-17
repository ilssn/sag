import { describe, expect, it } from "vitest";

import { isTerminalCode, parseLine, PROTOCOL_VERSION } from "./protocol";

describe("sidecar JSONL 协议解析", () => {
  it("解析 ready 事件", () => {
    const event = parseLine(
      '{"v":1,"event":"ready","nonce":"n","app_version":"1.2.2","api_version":"v1","protocol":1,"capabilities":["http-api"]}',
    );
    expect(event?.event).toBe("ready");
    expect(event?.nonce).toBe("n");
    expect(event?.protocol).toBe(PROTOCOL_VERSION);
    expect(event?.capabilities).toEqual(["http-api"]);
  });

  it("宽容未知字段与垃圾行", () => {
    expect(parseLine('{"v":1,"event":"start","future_field":42}')?.event).toBe("start");
    expect(parseLine("not-json")).toBeNull();
    expect(parseLine("")).toBeNull();
    expect(parseLine("[1,2,3]")).toBeNull();
    expect(parseLine('{"no_event":true}')).toBeNull();
  });

  it("终态错误码与 ADR-0017 一致", () => {
    for (const code of [
      "port-conflict",
      "instance-already-running",
      "migration-failed",
      "engine-data-incompatible",
    ]) {
      expect(isTerminalCode(code)).toBe(true);
    }
    expect(isTerminalCode("startup-failed")).toBe(false);
  });
});
