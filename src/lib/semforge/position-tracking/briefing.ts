export interface TrackedKeywordInput {
  id: number;
  keyword: string;
  position: number | null;
  previousPosition: number | null;
  updatedAt?: string | null;
}

export interface PositionTrackingBriefingData {
  ready: boolean;
  visibility: number;
  rankedCount: number;
  totalKeywords: number;
  avgPosition: number | null;
  top3Count: number;
  top10Count: number;
  improved: number;
  declined: number;
  stable: number;
  positionBuckets: Array<{ bucket: string; count: number }>;
  radar: Array<{ axis: string; score: number; hint: string }>;
  narratives: string[];
  recommendations: string[];
  keywords: Array<{
    id: number;
    keyword: string;
    position: number | null;
    previousPosition: number | null;
    delta: number | null;
    trend: "up" | "down" | "stable" | "new";
  }>;
}

function keywordTrend(
  position: number | null,
  previousPosition: number | null,
): { delta: number | null; trend: "up" | "down" | "stable" | "new" } {
  if (position === null || previousPosition === null) {
    return { delta: null, trend: "new" };
  }
  const delta = previousPosition - position;
  if (delta > 0) return { delta, trend: "up" };
  if (delta < 0) return { delta, trend: "down" };
  return { delta: 0, trend: "stable" };
}

function avgRankScore(avgPosition: number | null): number {
  if (avgPosition === null) return 0;
  return Math.max(0, Math.min(100, Math.round(100 - (avgPosition - 1) * 8)));
}

export function buildPositionTrackingBriefing(
  keywords: TrackedKeywordInput[],
  visibility: number,
): PositionTrackingBriefingData {
  const totalKeywords = keywords.length;
  const ranked = keywords.filter((item) => item.position !== null);
  const rankedCount = ranked.length;
  const top3Count = ranked.filter((item) => (item.position ?? 99) <= 3).length;
  const top10Count = ranked.filter((item) => (item.position ?? 99) <= 10).length;
  const avgPosition = rankedCount
    ? Number((ranked.reduce((sum, item) => sum + (item.position ?? 0), 0) / rankedCount).toFixed(1))
    : null;

  const enriched = keywords.map((item) => {
    const { delta, trend } = keywordTrend(item.position, item.previousPosition);
    return { ...item, delta, trend };
  });

  const improved = enriched.filter((item) => item.trend === "up").length;
  const declined = enriched.filter((item) => item.trend === "down").length;
  const stable = enriched.filter((item) => item.trend === "stable").length;

  const positionBuckets = [
    { bucket: "1–3위", count: ranked.filter((item) => (item.position ?? 99) <= 3).length },
    { bucket: "4–10위", count: ranked.filter((item) => (item.position ?? 99) >= 4 && (item.position ?? 99) <= 10).length },
    { bucket: "11–20위", count: ranked.filter((item) => (item.position ?? 99) >= 11 && (item.position ?? 99) <= 20).length },
    { bucket: "21위+", count: ranked.filter((item) => (item.position ?? 99) > 20).length },
    { bucket: "미노출", count: totalKeywords - rankedCount },
  ];

  const top10Score = totalKeywords ? Math.round((top10Count / totalKeywords) * 100) : 0;
  const top3Score = totalKeywords ? Math.round((top3Count / totalKeywords) * 100) : 0;
  const momentumScore = totalKeywords
    ? Math.max(0, Math.min(100, Math.round(50 + ((improved - declined) / totalKeywords) * 50)))
    : 0;

  const radar = [
    { axis: "Top 10 점유", score: top10Score, hint: `${top10Count}/${totalKeywords} 키워드가 10위 안에 있습니다.` },
    { axis: "Top 3 점유", score: top3Score, hint: `${top3Count}/${totalKeywords} 키워드가 3위 안에 있습니다.` },
    { axis: "평균 순위", score: avgRankScore(avgPosition), hint: avgPosition ? `평균 ${avgPosition}위 · 낮을수록 높은 점수` : "순위 데이터가 없습니다." },
    { axis: "가시성", score: visibility, hint: `SERP 노출 키워드 비율 ${visibility}%` },
    { axis: "모멘텀", score: momentumScore, hint: `상승 ${improved} · 하락 ${declined} · 유지 ${stable}` },
  ];

  const narratives: string[] = [];
  if (totalKeywords === 0) {
    narratives.push("추적 키워드를 추가한 뒤 '순위 수집'을 실행하면 분석 대시보드가 표시됩니다.");
  } else if (rankedCount === 0) {
    narratives.push(`${totalKeywords}개 키워드가 등록되어 있지만 아직 SERP 순위가 수집되지 않았습니다.`);
  } else {
    narratives.push(
      `${totalKeywords}개 키워드 중 ${rankedCount}개가 SERP에 노출되었고, 가시성 ${visibility}% · 평균 순위 ${avgPosition ?? "—"}위입니다.`,
    );
    if (top10Count > 0) narratives.push(`Top 10 진입 키워드 ${top10Count}개 · Top 3 ${top3Count}개입니다.`);
    if (improved > 0) narratives.push(`최근 수집 기준 ${improved}개 키워드 순위가 상승했습니다.`);
    if (declined > 0) narratives.push(`${declined}개 키워드는 순위가 하락했으므로 랜딩·내부링크를 점검하세요.`);
  }

  const recommendations = [
    rankedCount === 0 && totalKeywords > 0 ? "순위 수집을 실행해 TalorData SERP 실측 데이터를 확보하세요." : null,
    top10Count < totalKeywords && rankedCount > 0 ? "10위 밖 키워드는 콘텐츠 스튜디오(/studio)와 GEO 진단(/audit)으로 온페이지 신호를 보강하세요." : null,
    declined > improved && declined > 0 ? "하락 키워드부터 경쟁 SERP 스니펫·타이틀을 재정렬하세요." : null,
    visibility < 60 && rankedCount > 0 ? "가시성 60% 미만입니다. 핵심 키워드 허브 페이지와 내부 링크를 확장하세요." : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ready: rankedCount > 0,
    visibility,
    rankedCount,
    totalKeywords,
    avgPosition,
    top3Count,
    top10Count,
    improved,
    declined,
    stable,
    positionBuckets,
    radar,
    narratives,
    recommendations,
    keywords: enriched.sort((a, b) => {
      const posA = a.position ?? 999;
      const posB = b.position ?? 999;
      return posA - posB;
    }),
  };
}
