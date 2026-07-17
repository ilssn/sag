import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["electron/**/*.test.ts"],
    environment: "node",
    testTimeout: 40_000,
  },
  resolve: {
    alias: {
      // electron 运行时以纯 Node 桩替换(logging 等模块经其 app.getPath 落 tmp)
      electron: resolve(__dirname, "tests/electron.stub.ts"),
    },
  },
});
