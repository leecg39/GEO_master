import { z } from "zod";
import { AppError } from "@/lib/errors";
import { assertPublicUrl, normalizePublicUrl } from "@/lib/url-security";

const mapResponse = z.object({
  success: z.boolean().optional(),
  links: z
    .array(z.union([z.string().url(), z.object({ url: z.string().url() })]))
    .max(100_000),
});

export function parseMapLinks(payload: unknown, origin: string, limit = 25) {
  const parsed = mapResponse.safeParse(payload);
  if (!parsed.success || parsed.data.success === false)
    throw new AppError(
      "Firecrawl URL 응답 형식이 올바르지 않습니다.",
      502,
      "MAP_CONTRACT_ERROR",
    );
  const links = new Set<string>();
  for (const item of parsed.data.links) {
    try {
      const url = normalizePublicUrl(
        typeof item === "string" ? item : item.url,
      );
      if (url.origin !== origin) continue;
      // Query parameters and trailing slashes retain page identity until proven equivalent.
      links.add(url.toString());
      if (links.size >= limit) break;
    } catch {
      /* Out-of-scope or unsafe discovered URLs are never fetched. */
    }
  }
  return [...links];
}

export async function mapPublicSite(
  origin: string,
  apiKey: string,
  signal?: AbortSignal,
) {
  await assertPublicUrl(origin);
  const response = await fetch("https://api.firecrawl.dev/v2/map", {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: origin, limit: 25, includeSubdomains: false }),
  });
  if (!response.ok)
    throw new AppError(
      `Firecrawl URL 탐색 실패 (HTTP ${response.status})`,
      502,
      response.status === 429 ? "MAP_RATE_LIMIT" : "MAP_FAILED",
    );
  // One call, no automatic retry: a retry cannot silently spend additional credits.
  const reader = response.body?.getReader();
  if (!reader)
    throw new AppError(
      "Firecrawl 응답 본문이 없습니다.",
      502,
      "MAP_CONTRACT_ERROR",
    );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError(
          "Firecrawl 응답이 용량 제한을 초과했습니다.",
          502,
          "MAP_TOO_LARGE",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AppError(
      "Firecrawl JSON 응답을 읽지 못했습니다.",
      502,
      "MAP_CONTRACT_ERROR",
    );
  }
  return parseMapLinks(payload, origin);
}
