import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteQuestion, getQuestion, updateQuestion } from "@/lib/question-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuestionContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: QuestionContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ question: getQuestion(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: QuestionContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ question: updateQuestion(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: QuestionContext) {
  try {
    const { id } = await context.params;
    deleteQuestion(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
