import { AppError } from "@/lib/errors";

export interface ProviderFailure {
  code: string;
  message: string;
}

export function providerFailure(error: unknown): ProviderFailure {
  return {
    code: error instanceof AppError ? error.code : "PROVIDER_ERROR",
    message: error instanceof Error ? error.message : "수집 서비스 요청에 실패했습니다.",
  };
}

/** Account-wide failures must not trigger another billable request for each keyword. */
export function blocksProviderBatch(failure: ProviderFailure): boolean {
  return ["TALORDATA_PLAN_EXPIRED", "TALORDATA_CREDITS_EXHAUSTED", "TALORDATA_AUTH_FAILED", "TALORDATA_UNAVAILABLE", "RATE_LIMITED"].includes(failure.code);
}

/** SEMForge ApiError 코드 → GEO AppError 매핑 */
const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  DUPLICATE: 409,
  RATE_LIMITED: 429,
  INTERNAL: 502,
};

export function semforgeError(code: string, message: string, details?: unknown): AppError {
  const status = STATUS_BY_CODE[code] ?? 400;
  return new AppError(message, status, code, details);
}

export function subscriptionRequiredError(): AppError {
  return new AppError(
    "SEMForge Pro 구독(월 300,000원)이 필요합니다. /subscription 에서 결제 후 GEO 실행 기능을 사용할 수 있습니다.",
    402,
    "SEMFORGE_SUBSCRIPTION_REQUIRED",
  );
}
