import { getDatabase } from '../../../src/lib/db';
import { ensureActiveProject, updateProject } from '../../../src/lib/projects';
import { createQuestionSet, createQuestion } from '../../../src/lib/question-pool';
if (process.env.GEO_DB_PATH !== '/tmp/geo-halo-implementation-qa.db') throw new Error('QA DB only');
const original = ensureActiveProject();
const project = updateProject(original.id, { name: '통합 기능 검증', brandName: '가온분석', competitors: ['누리분석'], expectedUpdatedAt: original.updatedAt });
const set = createQuestionSet({ name: '검증용 핵심 질문' });
createQuestion(set.id, { text: '브랜드 AI 검색 분석에는 어떤 도구가 좋은가요?' });
const db = getDatabase().sqlite;
for (const [at, answer] of [['2026-10-20T12:00:00Z', '누리분석은 브랜드 AI 검색 분석 도구입니다.'], ['2026-10-24T12:00:00Z', '가온분석과 누리분석은 브랜드 분석 도구입니다.']] as const) {
 const run = db.prepare(`INSERT INTO measure_runs (project_id, title, status, models, repetitions, total_queries, summary, created_at, completed_at) VALUES (?, ?, 'completed', '[]', 1, 1, '{"searchMode":"web"}', ?, ?)`).run(project.id, 'QA 테스트 데이터 · '+at, at, at);
 db.prepare(`INSERT INTO measure_results (run_id, question_text, provider, model, repetition, response, brand_mentioned, sentiment, slot_status, search_mode, citation_supported, metric_version, created_at) VALUES (?, ?, 'openai', 'qa-model', 1, ?, 0, 'neutral', 'succeeded', 'web', 1, 'v2', ?)`).run(Number(run.lastInsertRowid), '브랜드 AI 검색 분석에는 어떤 도구가 좋은가요?', answer, at);
}
console.log({ projectId: project.id, questionSetId: set.id, database: process.env.GEO_DB_PATH });
