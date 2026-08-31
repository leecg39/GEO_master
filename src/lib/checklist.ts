import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "./db";
import { checklistStates } from "./db/schema";
import { AppError } from "./errors";
import { LEARN_CHECKLIST } from "./learn-content";

const updateSchema = z.object({
  itemKey: z.string().min(1).max(50),
  checked: z.boolean(),
});

export function getLearnChecklist() {
  const states = getDatabase().orm.select().from(checklistStates)
    .where(eq(checklistStates.scope, "learn-38"))
    .all();
  const stateMap = new Map(states.map((state) => [state.itemKey, state.checked]));
  const items = LEARN_CHECKLIST.map((item) => ({ ...item, checked: stateMap.get(item.id) ?? false }));
  return {
    items,
    completed: items.filter((item) => item.checked).length,
    total: items.length,
  };
}

export function updateLearnChecklist(input: unknown) {
  const parsed = updateSchema.parse(input);
  if (!LEARN_CHECKLIST.some((item) => item.id === parsed.itemKey)) {
    throw new AppError("알 수 없는 체크리스트 항목입니다.", 422, "UNKNOWN_CHECKLIST_ITEM");
  }
  getDatabase().sqlite.prepare(`
    INSERT INTO checklist_states (scope, item_key, checked, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope, item_key) DO UPDATE SET
      checked = excluded.checked,
      updated_at = excluded.updated_at
  `).run("learn-38", parsed.itemKey, parsed.checked ? 1 : 0, new Date().toISOString());
  return getLearnChecklist();
}
