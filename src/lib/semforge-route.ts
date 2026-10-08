import type { NextRequest } from "next/server";
import { errorResponse } from "./errors";
import { withRequestAccount } from "./request-account";
import { requireSemforgeSubscription } from "./semforge-subscription";

/** Enforces account context and access before parsing input or calling an upstream API. */
export function withSemforgeAccount(
  handler: (request: NextRequest) => Response | Promise<Response>,
  options: { requireSubscription?: boolean } = {},
) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      return await withRequestAccount(request.headers, async () => {
        if (options.requireSubscription) requireSemforgeSubscription();
        const response = await handler(request);
        response.headers.set("cache-control", "private, no-store");
        return response;
      });
    } catch (error) {
      const response = errorResponse(error);
      response.headers.set("cache-control", "private, no-store");
      return response;
    }
  };
}
