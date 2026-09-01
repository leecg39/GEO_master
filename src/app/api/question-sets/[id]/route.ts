import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { deleteQuestionSet, getQuestionSet, updateQuestionSet } from "@/lib/question-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuestionSetContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: QuestionSetContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ questionSet: getQuestionSet(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: QuestionSetContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ questionSet: updateQuestionSet(id, await request.json()) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: QuestionSetContext) {
  try {
    const { id } = await context.params;
    deleteQuestionSet(id, await request.json());
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
