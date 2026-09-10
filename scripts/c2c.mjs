import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const checkout = path.join(workspace, "tools", "codex-with-chatgpt");

if (!existsSync(path.join(checkout, "dist", "cli", "index.js"))) {
  process.stderr.write(
    "Codex with ChatGPT 설치 또는 빌드가 필요합니다. docs/codex-with-chatgpt/README.md를 확인하세요.\n",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [path.join(checkout, "bin", "c2c.js"), ...process.argv.slice(2)],
  {
    cwd: workspace,
    stdio: "inherit",
    env: {
      ...process.env,
      TUNNEL_TRANSPORT_PROTOCOL: process.env.TUNNEL_TRANSPORT_PROTOCOL ?? "http2",
      NODE_OPTIONS: [
        process.env.NODE_OPTIONS,
        `--import=${new URL("./c2c-network.mjs", import.meta.url).href}`,
      ].filter(Boolean).join(" "),
    },
  },
);

if (result.error) process.stderr.write(`${result.error.message}\n`);
process.exit(result.status ?? 1);
