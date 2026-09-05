import type Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, getDatabase, getDatabasePath } from "@/lib/db";

const projectName = "안나타르";
const brandName = "ANNATAR";
const competitors = ["토리든", "예스네이처", "라운드랩"];
const providers = ["openai", "anthropic", "gemini", "grok"] as const;
const providerModels = {
  openai: "gpt-5-mini",
  anthropic: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash",
  grok: "grok-3-mini",
};

const questions = [
  {
    text: "민감성 피부를 위한 저자극 수분크림 브랜드를 추천해 주세요.",
    intent: "추천형",
    segment: "민감성 피부",
    journeyStage: "비교",
  },
  {
    text: "국내 비건 스킨케어 브랜드의 성분과 보습력을 비교해 주세요.",
    intent: "비교형",
    segment: "비건 뷰티",
    journeyStage: "비교",
  },
  {
    text: "피부 장벽 개선에 도움이 되는 세라마이드 화장품은 무엇인가요?",
    intent: "문제 해결형",
    segment: "장벽 케어",
    journeyStage: "탐색",
  },
  {
    text: "데일리 루틴에 적합한 순한 클렌저와 토너 조합을 알려 주세요.",
    intent: "추천형",
    segment: "데일리 케어",
    journeyStage: "구매",
  },
  {
    text: "지속가능한 패키지를 사용하는 한국 스킨케어 브랜드는 어디인가요?",
    intent: "정보 탐색형",
    segment: "클린 뷰티",
    journeyStage: "탐색",
  },
  {
    text: "건조하고 예민한 피부에 맞는 스킨케어 브랜드 선택 기준은 무엇인가요?",
    intent: "정보 탐색형",
    segment: "건성 피부",
    journeyStage: "탐색",
  },
];

const runDates = [
  "2026-06-30T01:00:00.000Z",
  "2026-07-08T01:00:00.000Z",
  "2026-07-16T01:00:00.000Z",
  "2026-07-24T01:00:00.000Z",
  "2026-08-01T01:00:00.000Z",
  "2026-08-09T01:00:00.000Z",
  "2026-08-17T01:00:00.000Z",
  "2026-08-23T01:00:00.000Z",
  "2026-08-28T01:00:00.000Z",
  "2026-09-01T07:30:00.000Z",
];

const providerTargets: Record<(typeof providers)[number], number[]> = {
  openai: [38.9, 44.4, 44.4, 50, 55.6, 55.6, 61.1, 66.7, 72.2, 77.8],
  anthropic: [33.3, 38.9, 44.4, 44.4, 50, 55.6, 61.1, 66.7, 66.7, 72.2],
  gemini: [27.8, 33.3, 38.9, 44.4, 44.4, 50, 55.6, 61.1, 66.7, 66.7],
  grok: [22.2, 27.8, 33.3, 38.9, 44.4, 44.4, 50, 55.6, 61.1, 61.1],
};

const auditLabels = [
  "title과 meta description",
  "H1~H3 계층 구조",
  "Canonical URL",
  "Open Graph 태그",
  "내부 링크",
  "이미지 대체 텍스트",
  "검색 색인 허용",
  "질문형 소제목",
  "목록 구조",
  "비교 표",
  "FAQ 섹션",
  "결론 선행 도입부",
  "검색 의도 명시",
  "구매 여정별 구성",
  "작성자·검수자",
  "출처와 외부 인용",
  "수치·조건 근거",
  "발행일",
  "수정일·최신성",
  "회사·연락처 투명성",
  "JSON-LD",
  "FAQPage 스키마",
  "Organization/Article 스키마",
  "AI 크롤러 접근",
  "llms.txt",
  "XML Sitemap",
  "일관된 브랜드 정의",
  "엔티티 식별자",
  "권위 엔티티 연결",
  "다국어 맥락",
  "추천 조건·트리거",
  "소스 4중창",
];

const auditCategories = [
  "기반 SEO",
  "GEO 콘텐츠 구조",
  "신뢰도·E-E-A-T",
  "기술적 GEO",
  "브랜드 노출",
];

interface ResultRow {
  questionText: string;
  provider: (typeof providers)[number];
  model: string;
  repetition: number;
  response: string;
  brandMentioned: boolean;
  sentiment: string;
  mentionRank: number | null;
  competitorMentions: string;
}

function createResultRows(runIndex: number) {
  const rows: ResultRow[] = [];

  providers.forEach((provider, providerIndex) => {
    const cells: { questionIndex: number; repetition: number; score: number }[] = [];
    questions.forEach((_, questionIndex) => {
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        cells.push({
          questionIndex,
          repetition,
          score: (questionIndex * 17 + repetition * 11 + runIndex * 13 + providerIndex * 19) % 97,
        });
      }
    });

    cells.sort((left, right) => left.score - right.score || left.questionIndex - right.questionIndex || left.repetition - right.repetition);
    const mentionCount = Math.round((providerTargets[provider][runIndex] / 100) * cells.length);
    const mentioned = new Set(cells.slice(0, mentionCount).map((cell) => `${cell.questionIndex}:${cell.repetition}`));

    questions.forEach((question, questionIndex) => {
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        const key = `${questionIndex}:${repetition}`;
        const brandMentioned = mentioned.has(key);
        const sentimentSeed = questionIndex * 5 + repetition + runIndex * 2 + providerIndex;
        const sentiment = !brandMentioned
          ? "neutral"
          : sentimentSeed % 9 === 0
            ? "negative"
            : sentimentSeed % 5 === 0
              ? "neutral"
              : "positive";
        const competitor = competitors[(questionIndex + repetition + runIndex + providerIndex) % competitors.length];
        rows.push({
          questionText: question.text,
          provider,
          model: providerModels[provider],
          repetition,
          response: brandMentioned
            ? `${brandName}는 저자극 성분과 피부 장벽 케어를 중심으로 추천되는 브랜드입니다. ${competitor}와 비교해 성분 투명성과 지속가능한 패키지가 강점입니다.`
            : `${competitor}를 포함한 국내 스킨케어 브랜드를 피부 타입과 핵심 성분 기준으로 비교할 수 있습니다.`,
          brandMentioned,
          sentiment,
          mentionRank: brandMentioned ? 1 + ((questionIndex + repetition + providerIndex + runIndex) % 4) : null,
          competitorMentions: JSON.stringify([competitor]),
        });
      }
    });
  });

  return rows;
}

function summarizeRows(rows: ResultRow[], runIndex: number) {
  const mentionedRows = rows.filter((row) => row.brandMentioned);
  const perModel = Object.fromEntries(providers.map((provider) => {
    const providerRows = rows.filter((row) => row.provider === provider);
    const mentions = providerRows.filter((row) => row.brandMentioned).length;
    return [provider, {
      total: providerRows.length,
      mentions,
      share: Number(((mentions / providerRows.length) * 100).toFixed(1)),
    }];
  }));
  const positive = mentionedRows.filter((row) => row.sentiment === "positive").length;
  const competitorLift = runIndex * 0.8;

  return {
    total: rows.length,
    mentions: mentionedRows.length,
    positiveRate: mentionedRows.length ? Number(((positive / mentionedRows.length) * 100).toFixed(1)) : 0,
    perModel,
    competitorComparison: [
      { name: "토리든", share: Number((43.5 - competitorLift).toFixed(1)), mentions: Math.max(12, 31 - runIndex * 2) },
      { name: "예스네이처", share: Number((37.2 - competitorLift * 0.7).toFixed(1)), mentions: Math.max(10, 27 - runIndex) },
      { name: "라운드랩", share: Number((33.8 - competitorLift * 0.6).toFixed(1)), mentions: Math.max(8, 24 - runIndex) },
    ],
  };
}

export function seedAnnatarMock(sqlite: Database.Database = getDatabase().sqlite) {
  const seed = sqlite.transaction(() => {
    const now = "2026-09-01T07:30:00.000Z";
    let project = sqlite.prepare("SELECT id FROM projects WHERE name = ? ORDER BY id LIMIT 1").get(projectName) as { id: number } | undefined;

    if (!project) {
      const inserted = sqlite.prepare(`
        INSERT INTO projects (name, brand_name, category, competitors, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(projectName, brandName, "화장품", JSON.stringify(competitors), now, now);
      project = { id: Number(inserted.lastInsertRowid) };
    }

    const projectId = project.id;
    sqlite.prepare(`
      UPDATE projects
      SET brand_name = ?, category = ?, competitors = ?, updated_at = ?
      WHERE id = ?
    `).run(brandName, "화장품 · 비건 스킨케어", JSON.stringify(competitors), now, projectId);

    sqlite.prepare(`
      INSERT INTO settings (
        id, active_project_id, brand_name, category, competitors,
        models, repetitions, model_weights, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, '{}', 3, '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        active_project_id = excluded.active_project_id,
        updated_at = excluded.updated_at
    `).run(projectId, brandName, "화장품 · 비건 스킨케어", JSON.stringify(competitors), now, now);

    sqlite.prepare("DELETE FROM measure_runs WHERE project_id = ? AND client_request_id LIKE 'mock-annatar-run-%'").run(projectId);
    sqlite.prepare("DELETE FROM audits WHERE project_id = ? AND client_request_id = 'mock-annatar-audit'").run(projectId);
    sqlite.prepare("DELETE FROM question_sets WHERE project_id = ? AND name = '안나타르 GEO 모니터링 (Mock)'").run(projectId);
    sqlite.prepare("DELETE FROM checklist_states WHERE project_id = ? AND scope = 'learn-38' AND item_key LIKE 'mock-annatar-%'").run(projectId);
    sqlite.prepare("DELETE FROM strategy_items WHERE project_id = ? AND title LIKE '[MOCK] 안나타르%'").run(projectId);

    const questionSetResult = sqlite.prepare(`
      INSERT INTO question_sets (project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(projectId, "안나타르 GEO 모니터링 (Mock)", runDates[0], now);
    const questionSetId = Number(questionSetResult.lastInsertRowid);
    const insertQuestion = sqlite.prepare(`
      INSERT INTO questions (
        question_set_id, text, source, intent, segment, journey_stage,
        position, created_at, updated_at
      ) VALUES (?, ?, 'MockDB', ?, ?, ?, ?, ?, ?)
    `);
    questions.forEach((question, index) => {
      insertQuestion.run(
        questionSetId,
        question.text,
        question.intent,
        question.segment,
        question.journeyStage,
        index,
        runDates[0],
        now,
      );
    });

    const insertRun = sqlite.prepare(`
      INSERT INTO measure_runs (
        project_id, title, notes, client_request_id, status, models,
        repetitions, total_queries, answer_share, genrank, funnel_stage,
        summary, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, 'completed', ?, 3, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertResult = sqlite.prepare(`
      INSERT INTO measure_results (
        run_id, question_text, provider, model, repetition, response,
        brand_mentioned, sentiment, mention_rank, competitor_mentions, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const runIds: number[] = [];
    runDates.forEach((createdAt, runIndex) => {
      const rows = createResultRows(runIndex);
      const summary = summarizeRows(rows, runIndex);
      const answerShare = Number(((summary.mentions / summary.total) * 100).toFixed(1));
      const genrank = Number(Math.min(100, 24 + answerShare * 0.76).toFixed(1));
      const funnelStage = answerShare >= 65 ? "추천" : answerShare >= 50 ? "시의성" : answerShare >= 35 ? "맥락" : "존재";
      const runResult = insertRun.run(
        projectId,
        `안나타르 주간 GEO 측정 ${String(runIndex + 1).padStart(2, "0")}`,
        "[MOCK] 관제형 대시보드 시연 데이터",
        `mock-annatar-run-${String(runIndex + 1).padStart(2, "0")}`,
        JSON.stringify(providers),
        rows.length,
        answerShare,
        genrank,
        funnelStage,
        JSON.stringify(summary),
        createdAt,
        createdAt,
        createdAt,
      );
      const runId = Number(runResult.lastInsertRowid);
      runIds.push(runId);
      rows.forEach((row) => {
        insertResult.run(
          runId,
          row.questionText,
          row.provider,
          row.model,
          row.repetition,
          row.response,
          row.brandMentioned ? 1 : 0,
          row.sentiment,
          row.mentionRank,
          row.competitorMentions,
          createdAt,
        );
      });
    });

    const auditItems = auditLabels.map((label, index) => ({
      code: `mock-annatar-${String(index + 1).padStart(2, "0")}`,
      category: auditCategories[Math.min(auditCategories.length - 1, Math.floor(index / 7))],
      label,
      passed: index < 25,
      manual: [12, 13, 26, 28, 29, 30, 31].includes(index),
      detail: index < 25 ? "MockDB 기준 요구사항을 충족했습니다." : "근거 출처와 구조화 데이터를 보강해야 합니다.",
      recommendation: index < 25 ? "현재 상태를 유지하고 정기적으로 검토하세요." : "담당자와 기준일이 포함된 공개 근거를 추가하세요.",
    }));
    const auditResult = sqlite.prepare(`
      INSERT INTO audits (
        project_id, title, notes, client_request_id, url, score, grade,
        items, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, 'mock-annatar-audit', ?, 25, '양호', ?, ?, ?, ?)
    `).run(
      projectId,
      "안나타르 공식몰 GEO 진단 (Mock)",
      "[MOCK] 대시보드 시연용 진단",
      "https://annatar.example.com",
      JSON.stringify(auditItems),
      JSON.stringify({ mock: true, source: "seed-annatar-mock" }),
      now,
      now,
    );
    const auditId = Number(auditResult.lastInsertRowid);
    const insertAuditItem = sqlite.prepare(`
      INSERT INTO audit_items (audit_id, code, category, passed, manual, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    auditItems.forEach((item) => {
      insertAuditItem.run(auditId, item.code, item.category, item.passed ? 1 : 0, item.manual ? 1 : 0, item.detail);
    });

    const insertChecklist = sqlite.prepare(`
      INSERT INTO checklist_states (project_id, scope, item_key, checked, note, updated_at)
      VALUES (?, 'learn-38', ?, 1, '[MOCK] 완료 항목', ?)
    `);
    for (let index = 1; index <= 27; index += 1) {
      insertChecklist.run(projectId, `mock-annatar-${String(index).padStart(2, "0")}`, now);
    }

    const cycleRows = [
      { week: 1, label: "브랜드 엔티티 모니터링", status: "완료" },
      { week: 2, label: "모델별 답변 분석", status: "완료" },
      { week: 3, label: "경쟁 브랜드 우선순위", status: "완료" },
      { week: 4, label: "근거 콘텐츠 개선", status: "진행" },
    ];
    const insertCycle = sqlite.prepare(`
      INSERT INTO strategy_items (
        project_id, parent_id, type, title, data, status, created_at, updated_at
      ) VALUES (?, NULL, 'cycle', ?, ?, ?, ?, ?)
    `);
    cycleRows.forEach((item) => {
      insertCycle.run(
        projectId,
        `[MOCK] 안나타르 ${item.week}주차 · ${item.label}`,
        JSON.stringify({ week: item.week, label: item.label, mock: true }),
        item.status,
        now,
        now,
      );
    });

    const violations = sqlite.pragma("foreign_key_check") as unknown[];
    if (violations.length) throw new Error(`Foreign key check failed: ${JSON.stringify(violations)}`);

    return {
      projectId,
      questionSetId,
      questions: questions.length,
      runs: runIds.length,
      results: runIds.length * questions.length * providers.length * 3,
      auditId,
      checklistCompleted: 27,
      cycleItems: cycleRows.length,
    };
  });

  return seed();
}

const executedDirectly = Boolean(process.argv[1])
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (executedDirectly) {
  try {
    const result = seedAnnatarMock();
    console.log(JSON.stringify({ databasePath: getDatabasePath(), project: projectName, ...result }, null, 2));
  } finally {
    closeDatabase();
  }
}
