// Creates a disposable QA database. Never reads or modifies the user's project DB.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabase, closeDatabase } from "../../../src/lib/db/index";
import { createProject } from "../../../src/lib/projects";
import { createQuestionSet, createQuestion } from "../../../src/lib/question-pool";
import { monitoringQuestionKey } from "../../../src/lib/monitoring-matching";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "geo-monitoring-v2-qa-"));
process.env.GEO_DB_PATH = path.join(directory, "qa.db");
process.env.GEO_AUTH_MODE = "local";
const competitors = ["모토벨로", ...Array.from({ length: 19 }, (_, i) => `비교브랜드${String(i + 1).padStart(2, "0")}`)];
const project = createProject({ name: "QA · 라이클 모니터링", brandName: "라이클", brandAliases: ["LYCLE"], category: "모빌리티", competitors, activate: true });
const empty = createProject({ name: "QA · 미측정 프로젝트", brandName: "테스트상점", category: "기타", competitors: [], activate: false });
const set = createQuestionSet({ name: "레퍼런스 기반 QA 질문" });
const questions = [
  "배달용으로 전기자전거를 렌탈하는데 어디서 렌탈하면 좋을지 알려줘",
  "서울에서 전기자전거를 구매하려는데 장거리 배달에 적합하고 유지보수 서비스와 배터리 교체가 편리한 브랜드를 비교해 줘. ".repeat(3).trim(),
  "주변에서 전기자전거를 구매하려고 하는데 어디서 사면 좋을지 추천해줘",
  "배달용 전기자전거를 알아보고 있는데 어디서 사면 좋을지 알려줘",
  "전기자전거로 배달할 건데 어떤 전기자전거가 좋을지 추천해줘",
  ...Array.from({ length: 55 }, (_, i) => `미측정 질문 ${i + 1}: 지역별 자전거 수리 서비스를 추천해줘`),
];
for (const text of questions) createQuestion(set.id, { text });
const db = getDatabase().sqlite;
const runs: number[] = [];
db.transaction(() => {
  for (let week = 0; week < 7; week++) {
    const at = new Date(Date.UTC(2026, 7, 24 + week * 7, 0)).toISOString();
    const run = Number(db.prepare("INSERT INTO measure_runs(project_id,status,models,repetitions,total_queries,summary,created_at,completed_at) VALUES(?,'completed','[]',3,60,?,?,?)")
      .run(project.id, JSON.stringify({ searchMode: "web" }), at, at).lastInsertRowid);
    runs.push(run);
    for (let q = 0; q < (week >= 5 ? 4 : 5); q++) {
      for (const [p, provider] of ["openai", "anthropic", "gemini", "grok"].entries()) {
        if (week === 2 && provider === "gemini") continue;
        const repetitions = q === 0 && p === 0 && week >= 5 ? 23 : 3;
        for (let repetition = 1; repetition <= repetitions; repetition++) {
          const status = p === 1 && repetition === 3 ? "failed" : p === 2 && repetition === 3 ? "refused" : "succeeded";
          const own = (week + q + p + repetition) % 4 !== 0;
          const response = status === "failed" ? "" : status === "refused" ? "이 질문에 대한 답변을 제공할 수 없습니다." : `${own ? "라이클(LYCLE)을 확인해 보세요. " : "자사 브랜드가 등장하지 않는 응답입니다. "}모토벨로와 ${competitors.slice(1).join(", ")}도 비교해 보세요.\n\n실행 ${week + 1}, 반복 ${repetition}의 QA용 저장 응답입니다.\n<img src=x onerror=alert('QA')> 태그는 텍스트로 표시되어야 합니다.\nhttps://example.com/${"long-url-".repeat(40)}\n${"주행 거리·배터리·정비 조건을 확인하세요. ".repeat(10)}`;
          const mode = p === 3 || repetition % 3 === 0 ? "off" : "web";
          const id = Number(db.prepare(`INSERT INTO measure_results(run_id,question_text,provider,model,repetition,response,brand_mentioned,sentiment,slot_status,search_mode,search_performed,returned_model,metric_version,created_at)
            VALUES(?,?,?,?,?,?,0,'neutral',?,?,?,?,?,?)`).run(run, questions[q], provider, `${provider}-qa-${week === 3 ? "v2" : "v1"}`, repetition, response, status, mode,
              mode === "off" ? null : p === 2 ? 0 : 1, `${provider}-qa-returned`, "v2", at).lastInsertRowid);
          if (status === "succeeded") for (const kind of ["cited", "inline", "searched"]) {
            db.prepare("INSERT INTO measure_citations(run_id,result_id,url,title,domain,kind,category,created_at) VALUES(?,?,?,?,?,?,?,?)")
              .run(run, id, `https://example.com/${kind}/${"evidence-".repeat(30)}`, `${kind} 출처 QA`, "example.com", kind, kind === "cited" ? "own" : "other", at);
          }
        }
      }
    }
  }
  // A completed historical run with no raw answers must remain distinct from zero mentions.
  db.prepare("INSERT INTO measure_runs(project_id,status,models,repetitions,total_queries,summary,created_at,completed_at) VALUES(?,'completed','[]',1,0,'{}','2026-08-17T00:00:00Z','2026-08-17T00:00:00Z')").run(project.id);
})();
const manifest = { database: process.env.GEO_DB_PATH, projectId: project.id, emptyProjectId: empty.id, runs, questions: questions.map((text) => ({ text, key: monitoringQuestionKey(text) })), start: "2026-08-01", end: "2026-10-08" };
fs.writeFileSync(new URL("./qa-manifest.json", import.meta.url), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ database: manifest.database, projectId: project.id, questionCount: questions.length, runs }, null, 2));
closeDatabase();
