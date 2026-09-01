import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { createLlmsDocument, listLlmsDocuments } from "@/lib/llms-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    return NextResponse.json(listLlmsDocuments(Object.fromEntries(request.nextUrl.searchParams.entries())), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ document: createLlmsDocument(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
