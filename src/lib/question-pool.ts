import { z } from "zod";
import {
  assertDeleteAllowed,
  assertExpectedUpdatedAt,
  collectionQuerySchema,
  cursorPage,
  decodeCursor,
  expectFound,
  resourceIdSchema,
  transactionalMutation,
} from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { requireActiveProject } from "./projects";

const questionFields = {
  text: z.string().trim().min(5).max(500),
  source: z.string().trim().min(1).max(120),
  intent: z.string().trim().min(1).max(120),
  segment: z.string().trim().min(1).max(120),
  journeyStage: z.string().trim().min(1).max(120),
  position: z.number().int().min(0).max(100_000),
};

export const questionSetCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();

export const questionSetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

export const questionSetDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
  cascadeConfirmed: z.boolean().default(false),
}).strict();

export const questionCreateSchema = z.object({
  text: questionFields.text,
  source: questionFields.source.optional().default("직접 입력"),
  intent: questionFields.intent.optional().default("정보 탐색형"),
  segment: questionFields.segment.optional().default("전체"),
  journeyStage: questionFields.journeyStage.optional().default("탐색"),
  position: questionFields.position.optional(),
}).strict();

export const questionUpdateSchema = z.object({
  questionSetId: resourceIdSchema.optional(),
  text: questionFields.text.optional(),
  source: questionFields.source.optional(),
  intent: questionFields.intent.optional(),
  segment: questionFields.segment.optional(),
  journeyStage: questionFields.journeyStage.optional(),
  position: questionFields.position.optional(),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedUpdatedAt"), {
  message: "수정할 질문 필드를 하나 이상 입력해 주세요.",
});

export const questionDeleteSchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

export const questionReorderSchema = z.object({
  questionIds: z.array(resourceIdSchema).max(1_000).refine((ids) => new Set(ids).size === ids.length, {
    message: "질문 ID가 중복되었습니다.",
  }),
  expectedUpdatedAt: z.string().min(1).max(64),
}).strict();

interface QuestionSetRow {
  id: number;
  project_id: number | null;
  name: string;
  created_at: string;
  updated_at: string;
  question_count?: number;
}

interface QuestionRow {
  id: number;
  question_set_id: number | null;
  text: string;
  source: string;
  intent: string;
  segment: string;
  journey_stage: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionSetResource {
  id: number;
  projectId: number;
  name: string;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionResource {
  id: number;
  questionSetId: number;
  text: string;
  source: string;
  intent: string;
  segment: string;
  journeyStage: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

function nextTimestamp(...previousValues: Array<string | undefined>) {
  const previousTimes = previousValues
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite);
  return new Date(Math.max(Date.now(), ...previousTimes.map((value) => value + 1))).toISOString();
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function findQuestionSetRow(id: number) {
  return getDatabase().sqlite.prepare(`
    SELECT question_sets.*,
      (SELECT COUNT(*) FROM questions WHERE questions.question_set_id = question_sets.id) AS question_count
    FROM question_sets WHERE question_sets.id = ?
  `).get(id) as QuestionSetRow | undefined;
}

function findQuestionRow(id: number) {
  return getDatabase().sqlite.prepare("SELECT * FROM questions WHERE id = ?").get(id) as QuestionRow | undefined;
}

function ownedQuestionSet(id: number) {
  const row = expectFound(findQuestionSetRow(id), "질문 세트를 찾을 수 없습니다.", "QUESTION_SET_NOT_FOUND");
  const active = requireActiveProject();
  if (row.project_id !== active.id) {
    throw new AppError("활성 프로젝트의 질문 세트가 아닙니다.", 409, "PROJECT_SCOPE_MISMATCH");
  }
  return row;
}

function ownedQuestion(id: number) {
  const row = expectFound(findQuestionRow(id), "질문을 찾을 수 없습니다.", "QUESTION_NOT_FOUND");
  if (row.question_set_id === null) {
    throw new AppError("질문이 유효한 질문 세트에 연결되지 않았습니다.", 409, "QUESTION_SET_REQUIRED");
  }
  const set = ownedQuestionSet(row.question_set_id);
  return { row, set };
}

function toQuestionSet(row: QuestionSetRow): QuestionSetResource {
  return {
    id: row.id,
    projectId: row.project_id!,
    name: row.name,
    questionCount: Number(row.question_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toQuestion(row: QuestionRow): QuestionResource {
  return {
    id: row.id,
    questionSetId: row.question_set_id!,
    text: row.text,
    source: row.source,
    intent: row.intent,
    segment: row.segment,
    journeyStage: row.journey_stage,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function touchQuestionSet(id: number, previous?: string) {
  const row = expectFound(findQuestionSetRow(id), "질문 세트를 찾을 수 없습니다.", "QUESTION_SET_NOT_FOUND");
  const updatedAt = nextTimestamp(previous ?? row.updated_at);
  getDatabase().sqlite.prepare("UPDATE question_sets SET updated_at = ? WHERE id = ?").run(updatedAt, id);
  return updatedAt;
}

function normalizePositions(questionSetId: number, changedAt: string) {
  const { sqlite } = getDatabase();
  const rows = sqlite.prepare(`
    SELECT id, position FROM questions WHERE question_set_id = ? ORDER BY position ASC, id ASC
  `).all(questionSetId) as { id: number; position: number }[];
  const update = sqlite.prepare("UPDATE questions SET position = ?, updated_at = ? WHERE id = ?");
  rows.forEach((row, index) => {
    if (row.position !== index) update.run(index, changedAt, row.id);
  });
}

export function listQuestionSets(input: unknown) {
  const query = collectionQuerySchema.parse(input);
  const active = requireActiveProject();
  const where = ["question_sets.project_id = ?"];
  const parameters: Array<string | number> = [active.id];
  if (query.q) {
    where.push("question_sets.name LIKE ? ESCAPE '\\'");
    parameters.push(`%${escapeLike(query.q)}%`);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(question_sets.created_at < ? OR (question_sets.created_at = ? AND question_sets.id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT question_sets.*,
      (SELECT COUNT(*) FROM questions WHERE questions.question_set_id = question_sets.id) AS question_count
    FROM question_sets
    WHERE ${where.join(" AND ")}
    ORDER BY question_sets.created_at DESC, question_sets.id DESC
    LIMIT ?
  `).all(...parameters, query.limit + 1) as QuestionSetRow[];
  return cursorPage(rows.map(toQuestionSet), query.limit, (set) => ({ timestamp: set.createdAt, id: set.id }));
}

export function getQuestionSet(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  return toQuestionSet(ownedQuestionSet(id));
}

export function createQuestionSet(input: unknown) {
  const parsed = questionSetCreateSchema.parse(input);
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO question_sets (project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
    `).run(active.id, parsed.name, now, now);
    return toQuestionSet(expectFound(findQuestionSetRow(Number(result.lastInsertRowid)), "질문 세트를 만들지 못했습니다.", "QUESTION_SET_CREATE_FAILED"));
  });
}

export function updateQuestionSet(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = questionSetUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedQuestionSet(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    sqlite.prepare("UPDATE question_sets SET name = ?, updated_at = ? WHERE id = ?")
      .run(parsed.name, nextTimestamp(row.updated_at), id);
    return toQuestionSet(ownedQuestionSet(id));
  });
}

export function deleteQuestionSet(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = questionSetDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const row = ownedQuestionSet(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    assertDeleteAllowed({ questions: Number(row.question_count ?? 0) }, parsed.cascadeConfirmed, "QUESTION_SET_HAS_QUESTIONS");
    sqlite.prepare("DELETE FROM question_sets WHERE id = ?").run(id);
  });
}

export function listQuestions(questionSetIdInput: unknown, input: unknown) {
  const questionSetId = resourceIdSchema.parse(questionSetIdInput);
  ownedQuestionSet(questionSetId);
  const query = collectionQuerySchema.parse(input);
  const where = ["question_set_id = ?"];
  const parameters: Array<string | number> = [questionSetId];
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    where.push("(text LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR intent LIKE ? ESCAPE '\\' OR segment LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    parameters.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }
  const rows = getDatabase().sqlite.prepare(`
    SELECT * FROM questions WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...parameters, query.limit + 1) as QuestionRow[];
  return cursorPage(rows.map(toQuestion), query.limit, (question) => ({ timestamp: question.createdAt, id: question.id }));
}

export function getQuestion(idInput: unknown) {
  const id = resourceIdSchema.parse(idInput);
  return toQuestion(ownedQuestion(id).row);
}

export function createQuestion(questionSetIdInput: unknown, input: unknown) {
  const questionSetId = resourceIdSchema.parse(questionSetIdInput);
  const parsed = questionCreateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const set = ownedQuestionSet(questionSetId);
    const now = nextTimestamp(set.updated_at);
    const maxPosition = (sqlite.prepare("SELECT COALESCE(MAX(position), -1) AS position FROM questions WHERE question_set_id = ?").get(questionSetId) as { position: number }).position;
    const position = parsed.position === undefined ? maxPosition + 1 : Math.min(parsed.position, maxPosition + 1);
    if (parsed.position !== undefined) {
      sqlite.prepare("UPDATE questions SET position = position + 1, updated_at = ? WHERE question_set_id = ? AND position >= ?")
        .run(now, questionSetId, position);
    }
    const result = sqlite.prepare(`
      INSERT INTO questions (question_set_id, text, source, intent, segment, journey_stage, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(questionSetId, parsed.text, parsed.source, parsed.intent, parsed.segment, parsed.journeyStage, position, now, now);
    normalizePositions(questionSetId, now);
    touchQuestionSet(questionSetId, set.updated_at);
    return toQuestion(expectFound(findQuestionRow(Number(result.lastInsertRowid)), "질문을 만들지 못했습니다.", "QUESTION_CREATE_FAILED"));
  });
}

export function updateQuestion(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = questionUpdateSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const { row, set } = ownedQuestion(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const targetSetId = parsed.questionSetId ?? row.question_set_id!;
    const targetSet = targetSetId === set.id ? set : ownedQuestionSet(targetSetId);
    const updatedAt = nextTimestamp(row.updated_at, set.updated_at, targetSet.updated_at);
    normalizePositions(set.id, updatedAt);
    if (targetSetId !== set.id) normalizePositions(targetSetId, updatedAt);
    const normalizedRow = expectFound(findQuestionRow(id), "질문을 찾을 수 없습니다.", "QUESTION_NOT_FOUND");
    const oldPosition = normalizedRow.position;
    let position: number;
    if (targetSetId === set.id) {
      const count = (sqlite.prepare("SELECT COUNT(*) AS count FROM questions WHERE question_set_id = ?").get(set.id) as { count: number }).count;
      position = Math.min(parsed.position ?? oldPosition, Math.max(0, count - 1));
      if (position < oldPosition) {
        sqlite.prepare(`
          UPDATE questions SET position = position + 1, updated_at = ?
          WHERE question_set_id = ? AND id <> ? AND position >= ? AND position < ?
        `).run(updatedAt, set.id, id, position, oldPosition);
      } else if (position > oldPosition) {
        sqlite.prepare(`
          UPDATE questions SET position = position - 1, updated_at = ?
          WHERE question_set_id = ? AND id <> ? AND position > ? AND position <= ?
        `).run(updatedAt, set.id, id, oldPosition, position);
      }
    } else {
      const targetCount = (sqlite.prepare("SELECT COUNT(*) AS count FROM questions WHERE question_set_id = ?").get(targetSetId) as { count: number }).count;
      position = Math.min(parsed.position ?? targetCount, targetCount);
      sqlite.prepare(`
        UPDATE questions SET position = position - 1, updated_at = ?
        WHERE question_set_id = ? AND position > ?
      `).run(updatedAt, set.id, oldPosition);
      sqlite.prepare(`
        UPDATE questions SET position = position + 1, updated_at = ?
        WHERE question_set_id = ? AND position >= ?
      `).run(updatedAt, targetSetId, position);
    }
    sqlite.prepare(`
      UPDATE questions SET question_set_id = ?, text = ?, source = ?, intent = ?, segment = ?, journey_stage = ?, position = ?, updated_at = ?
      WHERE id = ?
    `).run(
      targetSetId,
      parsed.text ?? row.text,
      parsed.source ?? row.source,
      parsed.intent ?? row.intent,
      parsed.segment ?? row.segment,
      parsed.journeyStage ?? row.journey_stage,
      position,
      updatedAt,
      id,
    );
    normalizePositions(set.id, updatedAt);
    touchQuestionSet(set.id, set.updated_at);
    if (targetSetId !== set.id) {
      normalizePositions(targetSetId, updatedAt);
      touchQuestionSet(targetSetId, targetSet.updated_at);
    }
    return toQuestion(expectFound(findQuestionRow(id), "질문을 찾을 수 없습니다.", "QUESTION_NOT_FOUND"));
  });
}

export function deleteQuestion(idInput: unknown, input: unknown) {
  const id = resourceIdSchema.parse(idInput);
  const parsed = questionDeleteSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const { row, set } = ownedQuestion(id);
    assertExpectedUpdatedAt(row.updated_at, parsed.expectedUpdatedAt);
    const updatedAt = nextTimestamp(set.updated_at);
    sqlite.prepare("DELETE FROM questions WHERE id = ?").run(id);
    normalizePositions(set.id, updatedAt);
    touchQuestionSet(set.id, set.updated_at);
  });
}

export function reorderQuestions(questionSetIdInput: unknown, input: unknown) {
  const questionSetId = resourceIdSchema.parse(questionSetIdInput);
  const parsed = questionReorderSchema.parse(input);
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const set = ownedQuestionSet(questionSetId);
    assertExpectedUpdatedAt(set.updated_at, parsed.expectedUpdatedAt);
    const storedIds = (sqlite.prepare("SELECT id FROM questions WHERE question_set_id = ? ORDER BY id").all(questionSetId) as { id: number }[]).map((row) => row.id);
    if (storedIds.length !== parsed.questionIds.length || storedIds.some((id) => !parsed.questionIds.includes(id))) {
      throw new AppError("질문 목록이 변경되었습니다. 최신 목록을 불러온 뒤 다시 정렬해 주세요.", 409, "QUESTION_ORDER_CHANGED");
    }
    const updatedAt = nextTimestamp(set.updated_at);
    const update = sqlite.prepare("UPDATE questions SET position = ?, updated_at = ? WHERE id = ? AND question_set_id = ?");
    parsed.questionIds.forEach((id, position) => update.run(position, updatedAt, id, questionSetId));
    touchQuestionSet(questionSetId, set.updated_at);
    return parsed.questionIds.map((id) => toQuestion(expectFound(findQuestionRow(id), "질문을 찾을 수 없습니다.", "QUESTION_NOT_FOUND")));
  });
}
