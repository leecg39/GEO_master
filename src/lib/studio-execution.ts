import { randomUUID } from "node:crypto";
import { getDatabase } from "./db";
import { AppError } from "./errors";

interface Execution { requestId: string; token: string; projectId: number; requestHash: string }

/** A fresh token also fences legacy calls without a caller-provided idempotency key. */
export function beginStudioExecution(projectId: number, requestHash: string, clientRequestId?: string): Execution {
  const execution = { requestId: clientRequestId ?? randomUUID(), token: randomUUID(), projectId, requestHash };
  const { sqlite } = getDatabase();
  const inserted = sqlite.prepare(`INSERT OR IGNORE INTO studio_requests
    (request_id, execution_token, project_id, request_hash, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)`)
    .run(execution.requestId, execution.token, projectId, requestHash, new Date().toISOString());
  if (!inserted.changes) {
    const previous = sqlite.prepare("SELECT project_id, request_hash, status FROM studio_requests WHERE request_id = ?").get(execution.requestId) as { project_id: number; request_hash: string; status: string };
    if (previous.project_id !== projectId || previous.request_hash !== requestHash) throw new AppError("같은 요청 ID의 입력 또는 자료 버전이 변경되었습니다. 새 요청으로 실행하세요.", 409, "IDEMPOTENCY_KEY_REUSED");
    throw new AppError(previous.status === "failed" ? "이 요청은 실패했습니다. 새 요청으로 다시 실행하세요." : "이 요청은 실행 중이거나 결과 확인이 필요합니다. 이력을 확인하세요.", 409, "STUDIO_REQUEST_ALREADY_STARTED");
  }
  return execution;
}

/** Call inside the same synchronous transaction that stores the result. */
export function assertStudioExecution(execution: Execution) {
  const found = getDatabase().sqlite.prepare(`SELECT 1 FROM studio_requests
    WHERE request_id = ? AND execution_token = ? AND project_id = ? AND request_hash = ? AND status = 'running'`)
    .get(execution.requestId, execution.token, execution.projectId, execution.requestHash);
  if (!found) throw new AppError("생성 중 워크스페이스가 복원되거나 프로젝트가 삭제되어 결과를 저장하지 않았습니다. 현재 프로젝트에서 새 요청을 시작하세요.", 409, "STUDIO_CONTEXT_INVALIDATED");
}

export function finishStudioExecution(execution: Execution, status: "completed" | "failed") {
  getDatabase().sqlite.prepare("UPDATE studio_requests SET status = ? WHERE request_id = ? AND execution_token = ? AND status = 'running'")
    .run(status, execution.requestId, execution.token);
}
