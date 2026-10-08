import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // Local deployment artifacts are generated, git-ignored files, not application source.
  globalIgnores([".next/**", "coverage/**", "data/**", ".gstack/deploy/**", "next-env.d.ts"]),
]);
