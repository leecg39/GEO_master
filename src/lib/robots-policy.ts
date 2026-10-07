/**
 * Qshop 계획 P04 — robots.txt의 AI 크롤러 정책을 목적별로 나눠 해석한다 (RFC 9309).
 * - 검색 노출용(search), 모델 학습용(training), 사용자 요청 방문(user)을 같은 "AI 차단"으로 합치지 않는다
 *   OpenAI: "Each setting is independent" — GPTBot 차단은 학습 거부이고 OAI-SearchBot 검색 노출과 별개다
 *   Google: Google-Extended는 Google 검색 포함 여부와 순위에 영향을 주지 않는다
 * - 봇 자신의 그룹이 있으면 그 그룹만 쓰고, 없을 때만 * 그룹을 쓴다. 같은 봇 그룹이 여럿이면 합친다
 * - 경로 판정은 가장 긴 규칙이 이기고, 길이가 같으면 Allow가 이긴다
 * - robots.txt를 읽지 못하면 "허용"이 아니라 "확인 불가"다
 */

export type BotPurpose = "search" | "training" | "user";
export type BotAccessState = "allowed" | "partial" | "blocked" | "unknown";

export interface AiBot {
  token: string;
  operator: string;
  purpose: BotPurpose;
  note: string;
}

export const AI_BOTS: readonly AiBot[] = [
  { token: "OAI-SearchBot", operator: "OpenAI", purpose: "search", note: "ChatGPT 검색 답변 노출" },
  { token: "Claude-SearchBot", operator: "Anthropic", purpose: "search", note: "Claude 검색 색인" },
  { token: "PerplexityBot", operator: "Perplexity", purpose: "search", note: "Perplexity 검색 색인" },
  { token: "Googlebot", operator: "Google", purpose: "search", note: "Google 검색(AI 개요 포함)" },
  { token: "Bingbot", operator: "Microsoft", purpose: "search", note: "Bing 검색(Copilot 답변 근거)" },
  { token: "GPTBot", operator: "OpenAI", purpose: "training", note: "모델 학습 — 차단해도 ChatGPT 검색 노출과 별개" },
  { token: "ClaudeBot", operator: "Anthropic", purpose: "training", note: "모델 학습 — 차단해도 Claude 검색 색인과 별개" },
  { token: "Google-Extended", operator: "Google", purpose: "training", note: "Gemini 학습·Gemini 앱 그라운딩 제어 토큰 — Google 검색 포함 여부와 무관" },
  { token: "CCBot", operator: "Common Crawl", purpose: "training", note: "공개 크롤 데이터셋(여러 모델 학습에 쓰임)" },
  { token: "ChatGPT-User", operator: "OpenAI", purpose: "user", note: "사용자 요청 방문 — OpenAI는 robots.txt가 적용되지 않을 수 있다고 안내" },
  { token: "Claude-User", operator: "Anthropic", purpose: "user", note: "사용자 요청 방문" },
  { token: "Perplexity-User", operator: "Perplexity", purpose: "user", note: "사용자 요청 방문 — robots.txt가 일반적으로 적용되지 않음" },
];

interface Rule { allow: boolean; pattern: string; line: string }
interface Group { agents: string[]; rules: Rule[] }

export interface BotAccess extends AiBot {
  access: BotAccessState;
  /** 판정에 쓴 그룹: 봇 전용 / * / 해당 그룹 없음 */
  group: "specific" | "wildcard" | "none";
  /** 루트(/) 판정에 쓰인 규칙 원문 */
  matchedRule: string | null;
  /** 이 봇에 적용되는 비어 있지 않은 Disallow 규칙 수 */
  restrictedRules: number;
}

export interface RobotsPolicy {
  state: "parsed" | "missing" | "unknown";
  detail: string;
  bots: BotAccess[];
  summary: { searchBlocked: string[]; trainingBlocked: string[]; userBlocked: string[] };
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      collectingAgents = false;
      current.rules.push({ allow: key === "allow", pattern: value, line: `${key === "allow" ? "Allow" : "Disallow"}: ${value}` });
    } else if (key !== "sitemap") {
      collectingAgents = false;
    }
  }
  return groups;
}

function patternMatches(pattern: string, path: string) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

/** 경로에 적용되는 규칙 — 가장 긴 패턴, 같으면 Allow (RFC 9309 §2.2.2) */
function decide(rules: Rule[], path: string) {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!rule.pattern || !patternMatches(rule.pattern, path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)) best = rule;
  }
  return best;
}

/** 규칙이 실제로 적용되는 예시 경로 — 다른 규칙에 완전히 가려진 규칙은 효과가 없다 */
function samplePath(pattern: string) {
  const literal = pattern.replace(/\*/g, "x");
  return literal.endsWith("$") ? literal.slice(0, -1) : `${literal}x`;
}

function botAccess(bot: AiBot, groups: Group[]): BotAccess {
  const token = bot.token.toLowerCase();
  const own = groups.filter((group) => group.agents.includes(token));
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const rules = (own.length ? own : wildcard).flatMap((group) => group.rules);
  const root = decide(rules, "/");
  const effective = (allow: boolean) => rules.filter((rule) => rule.allow === allow && rule.pattern && decide(rules, samplePath(rule.pattern))?.allow === allow).length;
  const restrictedRules = effective(false);
  const access: BotAccessState = root && !root.allow
    ? (effective(true) > 0 ? "partial" : "blocked")
    : restrictedRules > 0 ? "partial" : "allowed";
  return {
    ...bot,
    group: own.length ? "specific" : wildcard.length ? "wildcard" : "none",
    access,
    matchedRule: root?.line ?? null,
    restrictedRules,
  };
}

function summarize(bots: BotAccess[]) {
  const blocked = (purpose: BotPurpose) => bots.filter((bot) => bot.purpose === purpose && bot.access === "blocked").map((bot) => bot.token);
  return { searchBlocked: blocked("search"), trainingBlocked: blocked("training"), userBlocked: blocked("user") };
}

export function analyzeRobotsTxt(text: string): RobotsPolicy {
  const groups = parseGroups(text);
  const bots = AI_BOTS.map((bot) => botAccess(bot, groups));
  return { state: "parsed", detail: `그룹 ${groups.length}개를 해석했습니다.`, bots, summary: summarize(bots) };
}

function withoutRules(state: "missing" | "unknown", detail: string): RobotsPolicy {
  const access: BotAccessState = state === "missing" ? "allowed" : "unknown";
  const bots = AI_BOTS.map((bot) => ({ ...bot, access, group: "none" as const, matchedRule: null, restrictedRules: 0 }));
  return { state, detail, bots, summary: summarize(bots) };
}

/** 실제 /robots.txt 응답 해석. 4xx는 제한 없음(RFC 9309), 429·5xx·네트워크 오류·HTML 응답은 확인 불가 */
export function robotsPolicyFromResponse(response: { status: number; text: string; contentType?: string } | null): RobotsPolicy {
  if (!response) return withoutRules("unknown", "robots.txt 요청 실패(네트워크·차단·시간 초과)");
  if (response.status >= 400 && response.status < 500 && response.status !== 429) return withoutRules("missing", `HTTP ${response.status} — robots.txt가 없어 제한이 없는 것으로 봅니다.`);
  if (response.status < 200 || response.status >= 300) return withoutRules("unknown", `HTTP ${response.status} — robots.txt를 읽지 못했습니다.`);
  if (/html/i.test(response.contentType ?? "") || /^\s*<(?:!doctype|html|head|body)/i.test(response.text)) {
    return withoutRules("unknown", "robots.txt 대신 HTML 페이지가 응답했습니다.");
  }
  return analyzeRobotsTxt(response.text);
}
