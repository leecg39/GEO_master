import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "입력값을 확인해 주세요.", code: "VALIDATION_ERROR", issues: error.issues },
      { status: 422 },
    );
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error("Unhandled server error", error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error");
  return NextResponse.json(
    { error: "요청을 처리하지 못했습니다.", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
