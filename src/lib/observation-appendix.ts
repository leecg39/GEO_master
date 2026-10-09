/**
 * Qshop P13 ② — 리포트용 관측 지표 부록.
 * 검색 성과·봇 관측·사업 성과를 원천별 정의·출처·기간과 함께 싣는다. 서로 합치거나 인과로 잇지 않는다.
 * 앱 안에서 내려받는 리포트에만 붙이고, 공개 공유 스냅샷에는 넣지 않는다(reports.ts 옵션).
 */
import { getBotLogImport, listBotLogImports } from "./bot-logs/store";
import { getOutcomeSummary } from "./outcomes/store";
import type { BotPurposeKey } from "./observation-labels";
import { listConsoleImports } from "./search-console/store";
import { summarizeConsoleImports } from "./search-console/summary";

const PURPOSE_ORDER: BotPurposeKey[] = ["search", "user", "training"];

function searchConsoleSection() {
  const summary = summarizeConsoleImports(listConsoleImports());
  return {
    status: summary.properties.length ? "connected" as const : "not_connected" as const,
    source: "Search Console 콘솔 내보내기(Excel) — 속성별 최신 파일",
    definition: "클릭·노출은 파일의 일별 합계, CTR = 클릭 ÷ 노출(노출 0이면 N/A), 평균 게재순위는 노출 가중 평균. 노출이 모두 0이면 성과 0인지 데이터 미축적인지 구분할 수 없어 '데이터 없음'으로 표시",
    properties: summary.properties.map(({ propertyLabel, latest }) => ({
      propertyLabel, periodStart: latest.periodStart, periodEnd: latest.periodEnd, hasData: latest.hasData,
      clicks: latest.totals.clicks, impressions: latest.totals.impressions, ctr: latest.totals.ctr, position: latest.totals.position,
    })),
  };
}

function botLogSection() {
  const latestImport = listBotLogImports()[0];
  const detail = latestImport ? getBotLogImport(latestImport.id) : null;
  return {
    status: detail ? "connected" as const : "not_connected" as const,
    source: "서버 접근 로그(combined) — 가장 최근에 가져온 파일 1개",
    definition: "User-Agent 자기 신고로 분류한 AI 크롤러 요청 수. DNS 진위 확인은 공식 방법이 있는 Googlebot·Bingbot만 가능하며, 나머지는 미확인. GEO Master 자체 진단 요청은 분리",
    latest: detail ? {
      fileName: detail.fileName, periodStart: detail.periodStart, periodEnd: detail.periodEnd, offsets: detail.offsets, dnsChecked: detail.dnsChecked,
      self: detail.totals.self, other: detail.totals.other,
      purposes: PURPOSE_ORDER.flatMap((purpose) => {
        const bots = detail.bots.filter((bot) => bot.purpose === purpose);
        if (!bots.length) return [];
        const sum = (key: "hits" | "verifiedHits" | "failedHits" | "uncheckedHits") => bots.reduce((total, bot) => total + bot[key], 0);
        return [{ purpose, hits: sum("hits"), verifiedHits: sum("verifiedHits"), failedHits: sum("failedHits"), uncheckedHits: sum("uncheckedHits") }];
      }),
    } : null,
  };
}

function outcomeSection() {
  const summary = getOutcomeSummary();
  return {
    status: summary.sources.length ? "connected" as const : "not_connected" as const,
    source: "사용자가 올린 이벤트 집계 CSV — 원천별",
    definition: "사용자가 의미를 정의한 이벤트만 CTA 클릭·폼 제출·전환으로 집계. 세 지표와 원천은 서로 합치지 않고 비율은 계산하지 않음. 겹치는 기간은 최신 파일 우선",
    sources: summary.sources.map((source) => ({
      sourceLabel: source.sourceLabel, periodStart: source.periodStart, periodEnd: source.periodEnd,
      metrics: source.metrics, unmappedEvents: source.unmapped.length,
    })),
  };
}

export function buildObservationAppendix() {
  return {
    note: "아래 지표는 원천과 기간이 서로 다릅니다. 합치거나 인과관계(봇 방문 → 인용 → 매출)로 해석하지 마세요.",
    searchConsole: searchConsoleSection(),
    botLogs: botLogSection(),
    outcomes: outcomeSection(),
  };
}
export type ObservationAppendix = ReturnType<typeof buildObservationAppendix>;
