import { NextResponse } from "next/server";
import { withSemforgeAccount } from "@/lib/semforge-route";
import { AppError } from "@/lib/errors";
import { deleteSearchPerformanceImport, getSearchPerformanceImport, importSearchPerformance, listSearchPerformanceImports } from "@/lib/search-performance";
import { MAX_GSC_FILE_BYTES } from "@/lib/search-performance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = Math.ceil(MAX_GSC_FILE_BYTES / 3) * 4 + 4096;

export const GET = withSemforgeAccount((request) => {
  const id = request.nextUrl.searchParams.get("id");
  return NextResponse.json(id ? { imported: getSearchPerformanceImport(id) } : listSearchPerformanceImports());
});

export const POST = withSemforgeAccount(async (request) => {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new AppError("JSON 형식으로 요청해 주세요.", 415, "JSON_REQUIRED");
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new AppError("Excel 파일은 5MB 이하여야 합니다.", 413, "GSC_FILE_TOO_LARGE");
  if (!request.body) throw new AppError("Excel 파일을 선택해 주세요.", 422, "FILE_REQUIRED");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new AppError("Excel 파일은 5MB 이하여야 합니다.", 413, "GSC_FILE_TOO_LARGE");
    }
    chunks.push(value);
  }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError("올바른 요청 형식이 아닙니다.", 422, "INVALID_JSON"); }
  const result = importSearchPerformance(input);
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
});

export const DELETE = withSemforgeAccount((request) => {
  deleteSearchPerformanceImport(request.nextUrl.searchParams.get("id"));
  return new NextResponse(null, { status: 204 });
});
