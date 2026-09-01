import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { createQuestion, listQuestions } from "@/lib/question-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuestionSetContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: QuestionSetContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(listQuestions(id, Object.fromEntries(request.nextUrl.searchParams.entries())), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, context: QuestionSetContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ question: createQuestion(id, await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
