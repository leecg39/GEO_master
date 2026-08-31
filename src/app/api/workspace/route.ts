import { NextRequest, NextResponse } from "next/server";
import { AppError, errorResponse } from "@/lib/errors";
import {
  MAX_WORKSPACE_BYTES, WORKSPACE_SCHEMA_VERSION, buildWorkspaceSnapshot, getWorkspaceStats,
  importWorkspace, serializeWorkspaceSnapshot,
} from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readLimitedJson(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_WORKSPACE_BYTES) throw new AppError("가져오기 파일은 25MB 이하여야 합니다.", 413, "SNAPSHOT_TOO_LARGE");
  if (!request.body) throw new AppError("가져올 스냅샷이 없습니다.", 400, "SNAPSHOT_REQUIRED");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0; let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WORKSPACE_BYTES) {
      await reader.cancel();
      throw new AppError("가져오기 파일은 25MB 이하여야 합니다.", 413, "SNAPSHOT_TOO_LARGE");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text) as unknown; }
  catch { throw new AppError("올바른 JSON 스냅샷 파일이 아닙니다.", 422, "INVALID_SNAPSHOT_JSON"); }
}

export function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("download") !== "1") {
      return NextResponse.json({
        workspace: { schemaVersion: WORKSPACE_SCHEMA_VERSION, stats: getWorkspaceStats(), apiKeysExcluded: true },
      }, { headers: { "cache-control": "no-store" } });
    }
    const snapshot = buildWorkspaceSnapshot();
    const body = serializeWorkspaceSnapshot(snapshot);
    const date = snapshot.exportedAt.slice(0, 10);
    return new NextResponse(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="geo-workspace-${date}.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      throw new AppError("JSON 형식으로 요청해 주세요.", 415, "JSON_REQUIRED");
    }
    return NextResponse.json({ result: importWorkspace(await readLimitedJson(request)) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
