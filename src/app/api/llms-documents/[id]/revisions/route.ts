import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listLlmsDocumentRevisions } from "@/lib/llms-documents";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json({
      revisions: listLlmsDocumentRevisions((await params).id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
