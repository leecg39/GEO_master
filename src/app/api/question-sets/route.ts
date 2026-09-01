import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { createQuestionSet, listQuestionSets } from "@/lib/question-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    return NextResponse.json(listQuestionSets(Object.fromEntries(request.nextUrl.searchParams.entries())), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json({ questionSet: createQuestionSet(await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
