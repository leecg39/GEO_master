export interface AiSeoSnapshotInput {
  aioPresent: boolean;
  cited: boolean | null;
  citedUrl: string | null;
  citedDomains: string[];
  organicPosition: number | null;
  features: string[];
  source: string;
  capturedAt: string;
}

export interface AiSeoQueryBriefingData {
  ready: boolean;
  query: string;
  domain: string;
  countryCode: string;
  device: string;
  visibilityScore: number;
  grade: { label: string; tone: "default" | "good" | "warn" | "bad" | "cyan" };
  aioPresent: boolean;
  cited: boolean | null;
  citedUrl: string | null;
  organicPosition: number | null;
  source: string;
  capturedAt: string;
  citedDomains: string[];
  featureChart: Array<{ name: string; active: number }>;
  scoreFactors: Array<{ key: string; label: string; points: number; kind: "base" | "bonus" | "penalty" | "total" }>;
  radar: Array<{ axis: string; score: number; hint: string }>;
  history: Array<{ label: string; visibilityScore: number; organicPosition: number | null; aioPresent: boolean }>;
  narratives: string[];
  recommendations: string[];
  deltas: {
    aioPresent: boolean | null;
    cited: boolean | null;
    organicPosition: number | null;
  };
}

const featureLabels: Record<string, string> = {
  ai_overview: "AI Overview",
  people_also_ask: "People Also Ask",
  featured_snippet: "Featured Snippet",
  knowledge_graph: "Knowledge Graph",
  local_pack: "Local Pack",
  top_stories: "Top Stories",
  video: "Video",
  images: "Images",
  shopping: "Shopping",
};

function organicScore(position: number | null): number {
  if (position === null) return 0;
  return Math.max(0, Math.min(30, Math.round(30 - (position - 1) * 3)));
}

function citationScore(aioPresent: boolean, cited: boolean | null): number {
  if (!aioPresent) return 0;
  if (cited === true) return 40;
  if (cited === false) return 10;
  return 20;
}

function aioScore(aioPresent: boolean): number {
  return aioPresent ? 30 : 0;
}

function visibilityGrade(score: number): { label: string; tone: "default" | "good" | "warn" | "bad" | "cyan" } {
  if (score >= 80) return { label: "우수", tone: "good" };
  if (score >= 60) return { label: "양호", tone: "cyan" };
  if (score >= 40) return { label: "보통", tone: "warn" };
  return { label: "개선 필요", tone: "bad" };
}

function computeVisibilityScore(snapshot: AiSeoSnapshotInput): number {
  return Math.min(100, aioScore(snapshot.aioPresent) + citationScore(snapshot.aioPresent, snapshot.cited) + organicScore(snapshot.organicPosition));
}

function buildScoreFactors(snapshot: AiSeoSnapshotInput): AiSeoQueryBriefingData["scoreFactors"] {
  const aio = aioScore(snapshot.aioPresent);
  const citation = citationScore(snapshot.aioPresent, snapshot.cited);
  const organic = organicScore(snapshot.organicPosition);
  const total = aio + citation + organic;
  return [
    { key: "aio", label: "AI Overview 출현", points: aio, kind: "base" },
    { key: "citation", label: "AIO 자사 인용", points: citation, kind: snapshot.cited === false ? "penalty" : "bonus" },
    { key: "organic", label: "오가닉 순위", points: organic, kind: "bonus" },
    { key: "total", label: "SERP 가시성 점수", points: total, kind: "total" },
  ];
}

function buildRadar(snapshot: AiSeoSnapshotInput, visibilityScore: number): AiSeoQueryBriefingData["radar"] {
  const featureCoverage = snapshot.features.length > 0
    ? Math.min(100, snapshot.features.length * 20)
    : 0;
  const geoReadiness = snapshot.aioPresent
    ? (snapshot.cited ? 90 : snapshot.cited === false ? 35 : 55)
    : snapshot.organicPosition !== null && snapshot.organicPosition <= 10 ? 50 : 20;

  return [
    { axis: "AIO 출현", score: snapshot.aioPresent ? 100 : 0, hint: snapshot.aioPresent ? "Google AI Overview가 노출됩니다." : "AI Overview가 없습니다." },
    { axis: "자사 인용", score: snapshot.cited === true ? 100 : snapshot.cited === false ? 15 : 50, hint: snapshot.cited === true ? "AIO에서 자사 도메인이 인용되었습니다." : snapshot.cited === false ? "AIO는 있으나 자사 인용이 없습니다." : "인용 판정 데이터가 없습니다." },
    { axis: "오가닉", score: organicScore(snapshot.organicPosition) * (100 / 30), hint: snapshot.organicPosition ? `오가닉 ${snapshot.organicPosition}위` : "오가닉 100위 밖" },
    { axis: "SERP 기능", score: featureCoverage, hint: `${snapshot.features.length}개 SERP 기능 감지` },
    { axis: "GEO 실행력", score: visibilityScore, hint: "AIO·인용·오가닉 종합 점수" },
  ];
}

function buildNarratives(
  snapshot: AiSeoSnapshotInput,
  visibilityScore: number,
  deltas: AiSeoQueryBriefingData["deltas"],
): string[] {
  const lines: string[] = [
    `SERP 가시성 ${visibilityScore}점 · AIO ${snapshot.aioPresent ? "출현" : "미출현"} · 오가닉 ${snapshot.organicPosition ?? "—"}위`,
  ];
  if (snapshot.aioPresent && snapshot.cited === true) {
    lines.push("AI Overview에서 자사 도메인이 인용되어 GEO 실행 신호가 강합니다.");
  } else if (snapshot.aioPresent && snapshot.cited === false) {
    lines.push("AI Overview는 노출되지만 자사 인용이 없어 Answer Share 확보가 필요합니다.");
  } else if (!snapshot.aioPresent && snapshot.organicPosition !== null && snapshot.organicPosition <= 10) {
    lines.push("AIO는 없지만 오가닉 상위 노출로 SERP 가시성을 확보하고 있습니다.");
  }
  if (deltas.organicPosition !== null && deltas.organicPosition > 0) {
    lines.push(`직전 수집 대비 오가닉 순위가 ${deltas.organicPosition}계 상승했습니다.`);
  } else if (deltas.organicPosition !== null && deltas.organicPosition < 0) {
    lines.push(`직전 수집 대비 오가닉 순위가 ${Math.abs(deltas.organicPosition)}계 하락했습니다.`);
  }
  if (snapshot.citedDomains.length > 0) {
    lines.push(`AIO 인용 도메인 ${snapshot.citedDomains.length}개 · ${snapshot.citedDomains.slice(0, 3).join(", ")}${snapshot.citedDomains.length > 3 ? " …" : ""}`);
  }
  return lines;
}

function buildRecommendations(snapshot: AiSeoSnapshotInput): string[] {
  return [
    snapshot.aioPresent && snapshot.cited !== true ? "AIO 인용을 위해 llms.txt·구조화 FAQ·출처 명시 콘텐츠를 보강하세요." : null,
    !snapshot.aioPresent ? "AIO 대상 쿼리인지 판단하고, GEO 진단(/audit)으로 엔티티·스키마 신호를 점검하세요." : null,
    snapshot.organicPosition === null || snapshot.organicPosition > 10 ? "오가닉 Top 10 진입을 위해 랜딩·내부링크 허브를 강화하세요." : null,
    snapshot.cited === true && (snapshot.organicPosition ?? 99) > 3 ? "인용은 확보되었습니다. 오가닉 1–3위를 위해 스니펫·타이틀을 최적화하세요." : null,
  ].filter((item): item is string => Boolean(item));
}

export function buildAiSeoQueryBriefing(input: {
  query: string;
  domain: string;
  countryCode: string;
  device: string;
  snapshots: AiSeoSnapshotInput[];
}): AiSeoQueryBriefingData {
  const latest = input.snapshots[0];
  if (!latest) {
    return {
      ready: false,
      query: input.query,
      domain: input.domain,
      countryCode: input.countryCode,
      device: input.device,
      visibilityScore: 0,
      grade: { label: "미측정", tone: "default" },
      aioPresent: false,
      cited: null,
      citedUrl: null,
      organicPosition: null,
      source: "",
      capturedAt: "",
      citedDomains: [],
      featureChart: [],
      scoreFactors: [],
      radar: [],
      history: [],
      narratives: ["아직 실측 수집이 실행되지 않았습니다."],
      recommendations: ["실측 수집을 실행해 TalorData SERP 데이터를 확보하세요."],
      deltas: { aioPresent: null, cited: null, organicPosition: null },
    };
  }

  const previous = input.snapshots[1];
  const visibilityScore = computeVisibilityScore(latest);
  const deltas = {
    aioPresent: previous ? latest.aioPresent !== previous.aioPresent ? latest.aioPresent : null : null,
    cited: previous && latest.cited !== null && previous.cited !== null && latest.cited !== previous.cited ? latest.cited : null,
    organicPosition: previous && latest.organicPosition !== null && previous.organicPosition !== null
      ? previous.organicPosition - latest.organicPosition
      : null,
  };

  const knownFeatures = Object.keys(featureLabels);
  const featureChart = knownFeatures.map((key) => ({
    name: featureLabels[key] ?? key,
    active: latest.features.includes(key) ? 1 : 0,
  })).filter((item) => item.active > 0);

  return {
    ready: true,
    query: input.query,
    domain: input.domain,
    countryCode: input.countryCode,
    device: input.device,
    visibilityScore,
    grade: visibilityGrade(visibilityScore),
    aioPresent: latest.aioPresent,
    cited: latest.cited,
    citedUrl: latest.citedUrl,
    organicPosition: latest.organicPosition,
    source: latest.source,
    capturedAt: latest.capturedAt,
    citedDomains: latest.citedDomains,
    featureChart,
    scoreFactors: buildScoreFactors(latest),
    radar: buildRadar(latest, visibilityScore),
    history: [...input.snapshots].reverse().map((snapshot, index) => ({
      label: `#${index + 1}`,
      visibilityScore: computeVisibilityScore(snapshot),
      organicPosition: snapshot.organicPosition,
      aioPresent: snapshot.aioPresent,
    })),
    narratives: buildNarratives(latest, visibilityScore, deltas),
    recommendations: buildRecommendations(latest),
    deltas,
  };
}
