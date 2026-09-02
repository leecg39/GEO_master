export interface MapRankKeywordInput {
  id: number;
  keyword: string;
  mapPosition: number | null;
  previousMapPosition: number | null;
  inLocalPack: boolean;
}

export interface LocalBusinessBriefingData {
  ready: boolean;
  visibility: number;
  rankedCount: number;
  totalKeywords: number;
  localPackCount: number;
  avgMapPosition: number | null;
  top3Count: number;
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
    mapPosition: number | null;
    previousMapPosition: number | null;
    inLocalPack: boolean;
    delta: number | null;
    trend: "up" | "down" | "stable" | "new";
  }>;
}

function keywordTrend(position: number | null, previous: number | null) {
  if (position === null || previous === null) return { delta: null, trend: "new" as const };
  const delta = previous - position;
  if (delta > 0) return { delta, trend: "up" as const };
  if (delta < 0) return { delta, trend: "down" as const };
  return { delta: 0, trend: "stable" as const };
}

export function buildLocalBusinessBriefing(
  keywords: MapRankKeywordInput[],
  visibility: number,
): LocalBusinessBriefingData {
  const totalKeywords = keywords.length;
  const ranked = keywords.filter((item) => item.mapPosition !== null);
  const rankedCount = ranked.length;
  const localPackCount = keywords.filter((item) => item.inLocalPack).length;
  const top3Count = ranked.filter((item) => (item.mapPosition ?? 99) <= 3).length;
  const avgMapPosition = rankedCount
    ? Number((ranked.reduce((sum, item) => sum + (item.mapPosition ?? 0), 0) / rankedCount).toFixed(1))
    : null;

  const enriched = keywords.map((item) => {
    const { delta, trend } = keywordTrend(item.mapPosition, item.previousMapPosition);
    return { ...item, delta, trend };
  });

  const improved = enriched.filter((item) => item.trend === "up").length;
  const declined = enriched.filter((item) => item.trend === "down").length;
  const stable = enriched.filter((item) => item.trend === "stable").length;

  const positionBuckets = [
    { bucket: "1–3위", count: ranked.filter((item) => (item.mapPosition ?? 99) <= 3).length },
    { bucket: "4–10위", count: ranked.filter((item) => (item.mapPosition ?? 99) >= 4 && (item.mapPosition ?? 99) <= 10).length },
    { bucket: "11위+", count: ranked.filter((item) => (item.mapPosition ?? 99) > 10).length },
    { bucket: "미노출", count: totalKeywords - rankedCount },
  ];

  const top3Score = totalKeywords ? Math.round((top3Count / totalKeywords) * 100) : 0;
  const packScore = totalKeywords ? Math.round((localPackCount / totalKeywords) * 100) : 0;
  const momentumScore = totalKeywords
    ? Math.max(0, Math.min(100, Math.round(50 + ((improved - declined) / totalKeywords) * 50)))
    : 0;

  const radar = [
    { axis: "Local Pack", score: packScore, hint: `${localPackCount}/${totalKeywords} 키워드가 Local Pack에 노출됩니다.` },
    { axis: "Top 3", score: totalKeywords ? Math.round((top3Count / totalKeywords) * 100) : 0, hint: `${top3Count}개 키워드가 Map 3위 안입니다.` },
    { axis: "평균 Map 순위", score: avgMapPosition ? Math.max(0, Math.min(100, Math.round(100 - (avgMapPosition - 1) * 10))) : 0, hint: avgMapPosition ? `평균 ${avgMapPosition}위` : "순위 없음" },
    { axis: "가시성", score: visibility, hint: `Map Rank 가시성 ${visibility}%` },
    { axis: "모멘텀", score: momentumScore, hint: `상승 ${improved} · 하락 ${declined}` },
  ];

  const narratives: string[] = [];
  if (totalKeywords === 0) {
    narratives.push("지역 키워드를 추가한 뒤 Map Rank 수집을 실행하세요.");
  } else if (rankedCount === 0) {
    narratives.push(`${totalKeywords}개 지역 키워드가 등록되어 있지만 아직 Map Rank가 수집되지 않았습니다.`);
  } else {
    narratives.push(
      `${totalKeywords}개 키워드 중 Local Pack 노출 ${localPackCount}개 · 가시성 ${visibility}% · 평균 Map ${avgMapPosition ?? "—"}위`,
    );
    if (top3Count > 0) narratives.push(`Map Top 3 진입 키워드 ${top3Count}개입니다.`);
    if (improved > 0) narratives.push(`${improved}개 키워드 Map 순위가 상승했습니다.`);
  }

  const recommendations = [
    rankedCount === 0 ? "Map Rank 수집을 실행해 Local Pack SERP 데이터를 확보하세요." : null,
    localPackCount < totalKeywords ? "미노출 키워드는 GBP 카테고리·리뷰·지역 키워드 NAP 일치를 점검하세요." : null,
    visibility < 60 && rankedCount > 0 ? "가시성 60% 미만입니다. 지역 랜딩·Google Maps URL·리뷰 응답을 강화하세요." : null,
    declined > improved && declined > 0 ? "하락 키워드의 경쟁 Local Pack 스니펫과 GBP 게시물을 비교하세요." : null,
  ].filter((item): item is string => Boolean(item));

  return {
    ready: rankedCount > 0,
    visibility,
    rankedCount,
    totalKeywords,
    localPackCount,
    avgMapPosition,
    top3Count,
    improved,
    declined,
    stable,
    positionBuckets,
    radar,
    narratives,
    recommendations,
    keywords: enriched.sort((a, b) => (a.mapPosition ?? 999) - (b.mapPosition ?? 999)),
  };
}
