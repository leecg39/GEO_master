import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { getQuestionSet, reorderQuestions } from "@/lib/question-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuestionSetContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: QuestionSetContext) {
  try {
    const { id } = await context.params;
    const questions = reorderQuestions(id, await request.json());
    return NextResponse.json({ questions, questionSet: getQuestionSet(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
