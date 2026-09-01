import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { activateProject, createProject, ensureActiveProject, updateProject } from "@/lib/projects";
import { GET as listSets, POST as createSet } from "@/app/api/question-sets/route";
import { DELETE as deleteSet, GET as getSet, PATCH as updateSet } from "@/app/api/question-sets/[id]/route";
import { GET as listQuestions, POST as createQuestion } from "@/app/api/question-sets/[id]/questions/route";
import { POST as reorderQuestions } from "@/app/api/question-sets/[id]/reorder/route";
import { DELETE as deleteQuestion, GET as getQuestion, PATCH as updateQuestion } from "@/app/api/questions/[id]/route";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geo-question-pool-"));
const databasePath = path.join(tempDir, "questions.db");
const previousDb = process.env.GEO_DB_PATH;
const previousKey = process.env.GEO_MASTER_KEY;

type SetResource = { id: number; projectId: number; name: string; questionCount: number; createdAt: string; updatedAt: string };
type QuestionResource = { id: number; questionSetId: number; text: string; source: string; intent: string; segment: string; journeyStage: string; position: number; createdAt: string; updatedAt: string };

let activeProjectId: number;
let secondProjectId: number;
let primarySet: SetResource;
let secondarySet: SetResource;
let firstQuestion: QuestionResource;
let secondQuestion: QuestionResource;
let thirdQuestion: QuestionResource;

const context = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function freshSet(id: number) {
  const response = await getSet(new NextRequest(`http://localhost/api/question-sets/${id}`), context(id));
  return (await response.json()).questionSet as SetResource;
}

beforeAll(() => {
  process.env.GEO_DB_PATH = databasePath;
  process.env.GEO_MASTER_KEY = "question-pool-test-master-key-32-characters";
  const active = ensureActiveProject();
  activeProjectId = active.id;
  updateProject(active.id, {
    name: "질문 프로젝트", brandName: "질문 브랜드", category: "분석", competitors: [], expectedUpdatedAt: active.updatedAt,
  });
  secondProjectId = createProject({
    name: "격리 프로젝트", brandName: "격리 브랜드", category: "기타", competitors: [], activate: false,
  }).id;
});

afterAll(() => {
  closeDatabase(databasePath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.GEO_DB_PATH; else process.env.GEO_DB_PATH = previousDb;
  if (previousKey === undefined) delete process.env.GEO_MASTER_KEY; else process.env.GEO_MASTER_KEY = previousKey;
});

describe.sequential("question set and question CRUD API", () => {
  it("strictly creates project-scoped sets and paginates/searches them", async () => {
    const invalid = await createSet(request("http://localhost/api/question-sets", "POST", { name: "잘못됨", extra: true }));
    expect(invalid.status).toBe(422);

    const primaryResponse = await createSet(request("http://localhost/api/question-sets", "POST", { name: "월간 핵심 질문" }));
    expect(primaryResponse.status).toBe(201);
    primarySet = (await primaryResponse.json()).questionSet;
    expect(primarySet).toMatchObject({ projectId: activeProjectId, name: "월간 핵심 질문", questionCount: 0 });

    const secondaryResponse = await createSet(request("http://localhost/api/question-sets", "POST", { name: "구매 여정 질문" }));
    secondarySet = (await secondaryResponse.json()).questionSet;

    const firstPage = await listSets(new NextRequest("http://localhost/api/question-sets?limit=1")).json();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    const secondPage = await listSets(new NextRequest(`http://localhost/api/question-sets?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor)}`)).json();
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);

    const searched = await listSets(new NextRequest(`http://localhost/api/question-sets?q=${encodeURIComponent("월간")}`)).json();
    expect(searched.items.map((set: SetResource) => set.id)).toEqual([primarySet.id]);
    const invalidQuery = listSets(new NextRequest("http://localhost/api/question-sets?order=name"));
    expect(invalidQuery.status).toBe(422);
  });

  it("creates questions with complete metadata, insertion position, detail and cursor list", async () => {
    const create = async (body: Record<string, unknown>) => {
      const response = await createQuestion(request(`http://localhost/api/question-sets/${primarySet.id}/questions`, "POST", body), context(primarySet.id));
      expect(response.status).toBe(201);
      return (await response.json()).question as QuestionResource;
    };
    firstQuestion = await create({ text: "좋은 분석 도구를 선택하는 기준은 무엇인가요?" });
    secondQuestion = await create({
      text: "초보자에게 적합한 분석 플랫폼을 비교해 주세요.", source: "고객 인터뷰", intent: "비교형", segment: "초보자", journeyStage: "고려",
    });
    thirdQuestion = await create({
      text: "기업용 분석 솔루션의 비용 구조는 어떻게 되나요?", source: "검색", intent: "가격 탐색", segment: "B2B", journeyStage: "검토", position: 0,
    });

    const allRows = getDatabase().sqlite.prepare("SELECT id, position FROM questions WHERE question_set_id = ? ORDER BY position, id").all(primarySet.id) as { id: number; position: number }[];
    expect(allRows).toEqual([
      { id: thirdQuestion.id, position: 0 }, { id: firstQuestion.id, position: 1 }, { id: secondQuestion.id, position: 2 },
    ]);

    const detail = await getQuestion(new NextRequest(`http://localhost/api/questions/${secondQuestion.id}`), context(secondQuestion.id));
    expect((await detail.json()).question).toMatchObject({ source: "고객 인터뷰", intent: "비교형", segment: "초보자", journeyStage: "고려" });

    const pageOne = await listQuestions(new NextRequest(`http://localhost/api/question-sets/${primarySet.id}/questions?limit=2`), context(primarySet.id)).then((response) => response.json());
    expect(pageOne.items).toHaveLength(2);
    expect(pageOne.page.hasMore).toBe(true);
    const pageTwo = await listQuestions(new NextRequest(`http://localhost/api/question-sets/${primarySet.id}/questions?limit=2&cursor=${encodeURIComponent(pageOne.page.nextCursor)}`), context(primarySet.id)).then((response) => response.json());
    expect(pageTwo.items).toHaveLength(1);
    expect(new Set([...pageOne.items, ...pageTwo.items].map((question: QuestionResource) => question.id)).size).toBe(3);

    primarySet = await freshSet(primarySet.id);
    expect(primarySet.questionCount).toBe(3);
  });

  it("rejects stale writes, updates every allowed field, and atomically reorders", async () => {
    const stale = await updateQuestion(request(`http://localhost/api/questions/${firstQuestion.id}`, "PATCH", {
      text: "오래된 질문 수정입니다.", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(firstQuestion.id));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE_WRITE");
    firstQuestion = (await getQuestion(new NextRequest(`http://localhost/api/questions/${firstQuestion.id}`), context(firstQuestion.id)).then((response) => response.json())).question as QuestionResource;

    const update = await updateQuestion(request(`http://localhost/api/questions/${firstQuestion.id}`, "PATCH", {
      text: "업데이트된 분석 도구 선정 기준을 알려주세요.", source: "영업팀", intent: "추천형", segment: "엔터프라이즈",
      journeyStage: "결정", position: 2, expectedUpdatedAt: firstQuestion.updatedAt,
    }), context(firstQuestion.id));
    expect(update.status).toBe(200);
    firstQuestion = (await update.json()).question;
    expect(firstQuestion).toMatchObject({ source: "영업팀", intent: "추천형", segment: "엔터프라이즈", journeyStage: "결정", position: 2 });

    primarySet = await freshSet(primarySet.id);
    const current = await listQuestions(new NextRequest(`http://localhost/api/question-sets/${primarySet.id}/questions?limit=100`), context(primarySet.id)).then((response) => response.json());
    const byPosition = (current.items as QuestionResource[]).sort((left, right) => left.position - right.position);
    const reversedIds = [...byPosition].reverse().map((question) => question.id);
    const reordered = await reorderQuestions(request(`http://localhost/api/question-sets/${primarySet.id}/reorder`, "POST", {
      questionIds: reversedIds, expectedUpdatedAt: primarySet.updatedAt,
    }), context(primarySet.id));
    expect(reordered.status).toBe(200);
    const reorderedBody = await reordered.json();
    expect(reorderedBody.questions.map((question: QuestionResource) => question.id)).toEqual(reversedIds);
    expect(reorderedBody.questions.map((question: QuestionResource) => question.position)).toEqual([0, 1, 2]);

    const staleOrder = await reorderQuestions(request(`http://localhost/api/question-sets/${primarySet.id}/reorder`, "POST", {
      questionIds: reversedIds, expectedUpdatedAt: primarySet.updatedAt,
    }), context(primarySet.id));
    expect(staleOrder.status).toBe(409);
    expect((await staleOrder.json()).code).toBe("STALE_WRITE");
  });

  it("moves a question between owned sets and persists set counts", async () => {
    const currentThird = (await getQuestion(new NextRequest(`http://localhost/api/questions/${thirdQuestion.id}`), context(thirdQuestion.id)).then((response) => response.json())).question as QuestionResource;
    const moved = await updateQuestion(request(`http://localhost/api/questions/${thirdQuestion.id}`, "PATCH", {
      questionSetId: secondarySet.id,
      position: 0,
      expectedUpdatedAt: currentThird.updatedAt,
    }), context(thirdQuestion.id));
    expect(moved.status).toBe(200);
    thirdQuestion = (await moved.json()).question;
    expect(thirdQuestion).toMatchObject({ questionSetId: secondarySet.id, position: 0 });

    firstQuestion = (await getQuestion(new NextRequest(`http://localhost/api/questions/${firstQuestion.id}`), context(firstQuestion.id)).then((response) => response.json())).question as QuestionResource;
    const movedIntoOccupied = await updateQuestion(request(`http://localhost/api/questions/${firstQuestion.id}`, "PATCH", {
      questionSetId: secondarySet.id, position: 0, expectedUpdatedAt: firstQuestion.updatedAt,
    }), context(firstQuestion.id));
    firstQuestion = (await movedIntoOccupied.json()).question;
    expect(firstQuestion).toMatchObject({ questionSetId: secondarySet.id, position: 0 });
    const shiftedThird = (await getQuestion(new NextRequest(`http://localhost/api/questions/${thirdQuestion.id}`), context(thirdQuestion.id)).then((response) => response.json())).question as QuestionResource;
    expect(shiftedThird.position).toBe(1);

    const movedBack = await updateQuestion(request(`http://localhost/api/questions/${firstQuestion.id}`, "PATCH", {
      questionSetId: primarySet.id, position: 1, expectedUpdatedAt: firstQuestion.updatedAt,
    }), context(firstQuestion.id));
    firstQuestion = (await movedBack.json()).question;
    expect(firstQuestion).toMatchObject({ questionSetId: primarySet.id, position: 1 });

    primarySet = await freshSet(primarySet.id);
    secondarySet = await freshSet(secondarySet.id);
    expect(primarySet.questionCount).toBe(2);
    expect(secondarySet.questionCount).toBe(1);
  });

  it("isolates all list/detail/mutation access by active project", async () => {
    activateProject(secondProjectId);
    const list = await listSets(new NextRequest("http://localhost/api/question-sets")).json();
    expect(list.items).toEqual([]);

    const foreignDetail = await getSet(new NextRequest(`http://localhost/api/question-sets/${primarySet.id}`), context(primarySet.id));
    expect(foreignDetail.status).toBe(409);
    expect((await foreignDetail.json()).code).toBe("PROJECT_SCOPE_MISMATCH");

    const isolated = await createSet(request("http://localhost/api/question-sets", "POST", { name: "격리 전용 질문" }));
    expect((await isolated.json()).questionSet.projectId).toBe(secondProjectId);
    activateProject(activeProjectId);
  });

  it("requires cascade confirmation for sets and supports stale-safe question deletion", async () => {
    primarySet = await freshSet(primarySet.id);
    const guarded = await deleteSet(request(`http://localhost/api/question-sets/${primarySet.id}`, "DELETE", {
      expectedUpdatedAt: primarySet.updatedAt, cascadeConfirmed: false,
    }), context(primarySet.id));
    expect(guarded.status).toBe(409);
    const guardedBody = await guarded.json();
    expect(guardedBody).toMatchObject({ code: "QUESTION_SET_HAS_QUESTIONS", details: { dependencies: { questions: 2 }, total: 2 } });

    const staleDelete = await deleteQuestion(request(`http://localhost/api/questions/${thirdQuestion.id}`, "DELETE", {
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(thirdQuestion.id));
    expect(staleDelete.status).toBe(409);
    const freshThird = (await getQuestion(new NextRequest(`http://localhost/api/questions/${thirdQuestion.id}`), context(thirdQuestion.id)).then((response) => response.json())).question as QuestionResource;
    const deletedQuestion = await deleteQuestion(request(`http://localhost/api/questions/${thirdQuestion.id}`, "DELETE", {
      expectedUpdatedAt: freshThird.updatedAt,
    }), context(thirdQuestion.id));
    expect(deletedQuestion.status).toBe(204);
    expect(getDatabase().sqlite.prepare("SELECT id FROM questions WHERE id = ?").get(thirdQuestion.id)).toBeUndefined();

    const deletedSet = await deleteSet(request(`http://localhost/api/question-sets/${primarySet.id}`, "DELETE", {
      expectedUpdatedAt: primarySet.updatedAt, cascadeConfirmed: true,
    }), context(primarySet.id));
    expect(deletedSet.status).toBe(204);
    expect(getDatabase().sqlite.prepare("SELECT id FROM question_sets WHERE id = ?").get(primarySet.id)).toBeUndefined();
    expect((getDatabase().sqlite.prepare("SELECT COUNT(*) AS count FROM questions WHERE question_set_id = ?").get(primarySet.id) as { count: number }).count).toBe(0);
    expect(getDatabase().sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("renames an empty set, rejects stale rename, deletes it, and returns 404 after reload", async () => {
    secondarySet = await freshSet(secondarySet.id);
    const renamed = await updateSet(request(`http://localhost/api/question-sets/${secondarySet.id}`, "PATCH", {
      name: "구매 여정 질문 v2", expectedUpdatedAt: secondarySet.updatedAt,
    }), context(secondarySet.id));
    expect(renamed.status).toBe(200);
    secondarySet = (await renamed.json()).questionSet;
    expect(secondarySet.name).toBe("구매 여정 질문 v2");

    const stale = await updateSet(request(`http://localhost/api/question-sets/${secondarySet.id}`, "PATCH", {
      name: "오래된 이름", expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    }), context(secondarySet.id));
    expect(stale.status).toBe(409);

    const deleted = await deleteSet(request(`http://localhost/api/question-sets/${secondarySet.id}`, "DELETE", {
      expectedUpdatedAt: secondarySet.updatedAt, cascadeConfirmed: false,
    }), context(secondarySet.id));
    expect(deleted.status).toBe(204);
    const missing = await getSet(new NextRequest(`http://localhost/api/question-sets/${secondarySet.id}`), context(secondarySet.id));
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("QUESTION_SET_NOT_FOUND");
  });
});
