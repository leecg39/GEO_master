import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // RSI 고정 평가(*.eval.ts)는 루프가 끝난 뒤 회귀 테스트로도 실행한다.
    include: [...configDefaults.include, "autoresearch/signup/eval/**/*.eval.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/db/schema.ts", "src/lib/llm.ts"],
    },
  },
});
