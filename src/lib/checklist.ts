import { z } from "zod";
import { transactionalMutation } from "./crud";
import { getDatabase } from "./db";
import { AppError } from "./errors";
import { LEARN_CHECKLIST } from "./learn-content";
import { requireActiveProject } from "./projects";

const SCOPE = "learn-38";

const updateSchema = z.object({
  itemKey: z.string().min(1).max(50),
  checked: z.boolean().optional(),
  note: z.string().trim().max(2_000).optional(),
}).strict().refine((value) => value.checked !== undefined || value.note !== undefined, {
  message: "체크 상태 또는 메모를 입력해 주세요.",
});

const resetSchema = z.object({
  reset: z.enum(["item", "category", "all"]),
  itemKey: z.string().min(1).max(50).optional(),
  category: z.string().min(1).max(80).optional(),
}).strict().superRefine((value, context) => {
  if (value.reset === "item" && !value.itemKey) {
    context.addIssue({ code: "custom", path: ["itemKey"], message: "초기화할 항목 키가 필요합니다." });
  }
  if (value.reset === "category" && !value.category) {
    context.addIssue({ code: "custom", path: ["category"], message: "초기화할 카테고리가 필요합니다." });
  }
});

interface ChecklistRow {
  item_key: string;
  checked: number;
  note: string;
}

function knownItem(itemKey: string) {
  return LEARN_CHECKLIST.find((item) => item.id === itemKey);
}

export function getLearnChecklist() {
  const active = requireActiveProject();
  const states = getDatabase().sqlite.prepare(`
    SELECT item_key, checked, note FROM checklist_states WHERE project_id = ? AND scope = ?
  `).all(active.id, SCOPE) as ChecklistRow[];
  const stateMap = new Map(states.map((state) => [state.item_key, state]));
  const items = LEARN_CHECKLIST.map((item) => {
    const state = stateMap.get(item.id);
    return { ...item, checked: Boolean(state?.checked), note: state?.note ?? "" };
  });
  return {
    items,
    completed: items.filter((item) => item.checked).length,
    total: items.length,
  };
}

export function updateLearnChecklist(input: unknown) {
  const parsed = updateSchema.parse(input);
  if (!knownItem(parsed.itemKey)) {
    throw new AppError("알 수 없는 체크리스트 항목입니다.", 422, "UNKNOWN_CHECKLIST_ITEM");
  }
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    const now = new Date().toISOString();
    const current = sqlite.prepare(`
      SELECT checked, note FROM checklist_states WHERE project_id = ? AND scope = ? AND item_key = ?
    `).get(active.id, SCOPE, parsed.itemKey) as { checked: number; note: string } | undefined;
    sqlite.prepare(`
      INSERT INTO checklist_states (project_id, scope, item_key, checked, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, scope, item_key) DO UPDATE SET
        checked = excluded.checked,
        note = excluded.note,
        updated_at = excluded.updated_at
    `).run(
      active.id,
      SCOPE,
      parsed.itemKey,
      (parsed.checked ?? Boolean(current?.checked)) ? 1 : 0,
      parsed.note ?? current?.note ?? "",
      now,
    );
    return getLearnChecklist();
  });
}

export function resetLearnChecklist(input: unknown) {
  const parsed = resetSchema.parse(input);
  const active = requireActiveProject();
  const { sqlite } = getDatabase();
  return transactionalMutation(sqlite, () => {
    if (parsed.reset === "all") {
      sqlite.prepare("DELETE FROM checklist_states WHERE project_id = ? AND scope = ?").run(active.id, SCOPE);
      return getLearnChecklist();
    }
    if (parsed.reset === "item") {
      if (!knownItem(parsed.itemKey!)) throw new AppError("알 수 없는 체크리스트 항목입니다.", 422, "UNKNOWN_CHECKLIST_ITEM");
      sqlite.prepare("DELETE FROM checklist_states WHERE project_id = ? AND scope = ? AND item_key = ?")
        .run(active.id, SCOPE, parsed.itemKey);
      return getLearnChecklist();
    }
    const keys = LEARN_CHECKLIST.filter((item) => item.category === parsed.category).map((item) => item.id);
    if (!keys.length) throw new AppError("알 수 없는 체크리스트 카테고리입니다.", 422, "UNKNOWN_CHECKLIST_CATEGORY");
    sqlite.prepare(`
      DELETE FROM checklist_states WHERE project_id = ? AND scope = ? AND item_key IN (${keys.map(() => "?").join(",")})
    `).run(active.id, SCOPE, ...keys);
    return getLearnChecklist();
  });
}
