import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@bubble/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)), "@bubble/engine": fileURLToPath(new URL("./packages/engine/src/index.ts", import.meta.url)) } },
  test: { include: ["packages/engine/tests/**/*.test.ts", "frontend/tests/**/*.test.ts"] },
});
