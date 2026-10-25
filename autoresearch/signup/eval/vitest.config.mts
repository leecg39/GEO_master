import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Frozen evaluator config: only the RSI benchmark runs here, never in `npm test`.
export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("../../../src", import.meta.url)) } },
  test: { environment: "node", include: ["autoresearch/signup/eval/**/*.eval.ts"], testTimeout: 30000 },
});
