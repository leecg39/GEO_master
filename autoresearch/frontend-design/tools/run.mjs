process.env.FRONTEND_BASE_URL = "http://127.0.0.1:3002";
const { runDesign, configs, routes } = await import("/Users/user01/Desktop/GEO_master/autoresearch/frontend-design/eval/design.mjs?" + Date.now());
const task = await taskSpace(54);
const tag = globalThis.RUN_TAG;
const dir = `/Users/user01/Desktop/GEO_master/.gstack/frontend-design/shots-${tag}`;
const fs = await import("node:fs/promises"); await fs.mkdir(dir, { recursive: true });
await runDesign(task.page("p1"), { onlyRoutes: globalThis.ROUTES || routes, onlyConfigs: globalThis.CONFIGS ? configs.filter(c => globalThis.CONFIGS.includes(c.name)) : configs, output: `/Users/user01/Desktop/GEO_master/autoresearch/frontend-design/results/${tag}-pages.json`, shots: dir });
