import { AI_BOTS, type AiBot } from "@/lib/robots-policy";

/** GEO Master 자체 진단 크롤러(url-security.ts)의 User-Agent 표식 */
export const SELF_USER_AGENT_MARK = "GEO-Master-Audit";

/** 로그에 나타나는 User-Agent 토큰만. Google-Extended는 robots.txt 제어 토큰이라 요청 UA에 나오지 않는다 */
export const LOG_BOTS: readonly AiBot[] = AI_BOTS.filter((bot) => bot.token !== "Google-Extended");

export type UserAgentClass = { kind: "ai_bot"; bot: AiBot } | { kind: "self" } | { kind: "other" };

/** User-Agent 자기 신고로만 분류한다(진위는 verify.ts에서 따로 판단) */
export function classifyUserAgent(userAgent: string): UserAgentClass {
  if (userAgent.includes(SELF_USER_AGENT_MARK)) return { kind: "self" };
  const lower = userAgent.toLowerCase();
  const bot = LOG_BOTS.find((item) => lower.includes(item.token.toLowerCase()));
  return bot ? { kind: "ai_bot", bot } : { kind: "other" };
}
