/**
 * 공식 문서가 역방향+정방향 DNS 확인 방법을 안내하는 봇만 검증한다.
 * - Google: googlebot.com / google.com 호스트, Microsoft: search.msn.com 호스트
 * 그 밖의 운영사(OpenAI·Anthropic·Perplexity 등)는 IP 목록을 공개하지만 여기서는 확인하지 않아 "unchecked"다.
 * DNS 오류·시간 초과는 검증 성공도 실패도 아닌 "unchecked"로 둔다.
 */
import { promises as dns } from "node:dns";

export type VerificationState = "verified" | "failed" | "unchecked";

export interface DnsResolver {
  reverse(ip: string): Promise<string[]>;
  lookup(host: string): Promise<string[]>;
}

export const DNS_VERIFIABLE: Readonly<Record<string, readonly string[]>> = {
  Googlebot: [".googlebot.com", ".google.com"],
  Bingbot: [".search.msn.com"],
};

const systemResolver: DnsResolver = {
  reverse: (ip) => dns.reverse(ip),
  lookup: async (host) => (await dns.lookup(host, { all: true, verbatim: true })).map((item) => item.address),
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS_TIMEOUT")), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

async function verifyOne(ip: string, suffixes: readonly string[], resolver: DnsResolver, timeoutMs: number): Promise<VerificationState> {
  let hosts: string[];
  try {
    hosts = await withTimeout(resolver.reverse(ip), timeoutMs);
  } catch (error) {
    // PTR 레코드가 아예 없으면 해당 운영사 크롤러가 아니다. 그 밖의 DNS 오류는 판단하지 않는다
    return (error as { code?: string }).code === "ENOTFOUND" ? "failed" : "unchecked";
  }
  const host = hosts.map((item) => item.toLowerCase().replace(/\.$/, "")).find((item) => suffixes.some((suffix) => item.endsWith(suffix)));
  if (!host) return "failed";
  try {
    const addresses = await withTimeout(resolver.lookup(host), timeoutMs);
    return addresses.includes(ip) ? "verified" : "failed";
  } catch {
    return "unchecked";
  }
}

/** 봇 토큰별 IP 목록을 검증해 "토큰|IP" → 상태 맵을 돌려준다. 봇당 확인 IP 수를 제한한다 */
export async function verifyBotIps(
  ipsByBot: ReadonlyMap<string, readonly string[]>,
  { resolver = systemResolver, maxIpsPerBot = 20, timeoutMs = 3_000, concurrency = 5 }: { resolver?: DnsResolver; maxIpsPerBot?: number; timeoutMs?: number; concurrency?: number } = {},
) {
  const result = new Map<string, VerificationState>();
  const tasks: Array<() => Promise<void>> = [];
  for (const [token, ips] of ipsByBot) {
    const suffixes = DNS_VERIFIABLE[token];
    const unique = [...new Set(ips)];
    unique.forEach((ip, index) => {
      result.set(`${token}|${ip}`, "unchecked");
      if (suffixes && index < maxIpsPerBot) {
        tasks.push(async () => { result.set(`${token}|${ip}`, await verifyOne(ip, suffixes, resolver, timeoutMs)); });
      }
    });
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) await tasks[next++]!();
  }));
  return result;
}
