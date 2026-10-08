import { describe, expect, it } from "vitest";
import {
  crossover, crowdingDistance, extractCitedSentences, FEATURE_KEYS, FEATURES, impressionPosCount, impressionWordCount,
  impressionWordPos, mutate, nonDominatedSort, paretoFront, profileText, randomConfig, seededRandom, selectByNsga2,
  toGuidelines, type FeatureConfig,
} from "@/lib/featgeo";

const inRange = (config: FeatureConfig) => FEATURE_KEYS.every((key) => {
  const [lo, hi] = FEATURES[key].range;
  return config[key] >= lo && config[key] <= hi;
});

describe("feature space", () => {
  it("defines the 13 FeatGEO features across structure, content and language layers", () => {
    expect(FEATURE_KEYS).toHaveLength(13);
    expect(new Set(FEATURE_KEYS.map((key) => FEATURES[key].layer))).toEqual(new Set(["structure", "content", "language"]));
  });

  it("produces reproducible random configs, crossover and mutation inside each feature range", () => {
    const a = randomConfig(seededRandom(1));
    expect(randomConfig(seededRandom(1))).toEqual(a);
    const b = randomConfig(seededRandom(2));
    const child = mutate(crossover(a, b, seededRandom(3)), seededRandom(4), 1, 5);
    expect(inRange(a) && inRange(b) && inRange(child)).toBe(true);
  });

  it("never instructs the writer to invent statistics, sources or quotes", () => {
    const high = Object.fromEntries(FEATURE_KEYS.map((key) => [key, FEATURES[key].range[1]])) as FeatureConfig;
    const guidelines = toGuidelines(high, { hasFacts: false, allowedSources: [], quotes: [] });
    expect(guidelines).not.toMatch(/hypothetical|invent|fake|가상의|지어/);
    expect(guidelines).toContain("수치를 새로 만들지 마세요");
    expect(guidelines).toContain("출처를 언급하지 마세요");
    expect(guidelines).toContain("인용문을 쓰지 마세요");
    expect(guidelines).toContain("보장");
  });

  it("allows only listed sources and provided quotes when they exist", () => {
    const high = Object.fromEntries(FEATURE_KEYS.map((key) => [key, FEATURES[key].range[1]])) as FeatureConfig;
    const guidelines = toGuidelines(high, { hasFacts: true, allowedSources: ["https://gov.example/report"], quotes: ["\"품질이 우선입니다\" — 대표"] });
    expect(guidelines).toContain("https://gov.example/report");
    expect(guidelines).toContain("품질이 우선입니다");
  });
});

describe("profileText", () => {
  it("estimates structural and content features from markdown-like text", () => {
    const text = "# 제목\n요약: 이 글은 핵심을 설명합니다.\n\n## 소제목\n- 항목 1\n- 항목 2\n\n가격은 12,000원입니다. 한국소비자원에 따르면 만족도가 높습니다. \"좋다\"고 말했습니다.";
    const profile = profileText(text);
    expect(inRange(profile)).toBe(true);
    expect(profile.headings_level).toBeGreaterThan(1);
    expect(profile.list_density).toBeGreaterThan(0);
    expect(profile.statistics_level).toBeGreaterThan(0);
    expect(profile.quotation_level).toBeGreaterThan(0);
  });
});

describe("impression metrics", () => {
  const answer = "첫 문장은 원천 하나를 인용합니다 [1].\n둘째 문장은 두 출처를 함께 씁니다 [1][2].\n\n마지막 문단은 2번만 씁니다 [2].";

  it("extracts cited source ids per sentence", () => {
    const sentences = extractCitedSentences(answer);
    expect(sentences.map((sentence) => sentence.cites)).toEqual([[1], [1, 2], [2]]);
  });

  it("splits credit across co-cited sources and decays by position", () => {
    const sentences = extractCitedSentences(answer);
    const wordPos = impressionWordPos(sentences, 2);
    expect(wordPos[0]! + wordPos[1]!).toBeCloseTo(1);
    expect(wordPos[0]).toBeGreaterThan(wordPos[1]!);
    expect(impressionWordCount(sentences, 2)[0]! + impressionWordCount(sentences, 2)[1]!).toBeCloseTo(1);
    expect(impressionPosCount(sentences, 2)[0]).toBeGreaterThan(0.5);
  });

  it("ignores hallucinated citation ids and returns uniform scores when nothing is cited", () => {
    expect(impressionWordPos(extractCitedSentences("근거 없는 문장 [9]."), 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });
});

describe("NSGA-II", () => {
  const objectives: Array<[number, number]> = [[0.9, 0.2], [0.5, 0.5], [0.2, 0.9], [0.4, 0.4], [0.1, 0.1]];

  it("sorts candidates into Pareto fronts", () => {
    expect(nonDominatedSort(objectives)).toEqual([[0, 1, 2], [3], [4]]);
    expect(paretoFront(objectives)).toEqual([0, 1, 2]);
  });

  it("gives boundary points infinite crowding distance", () => {
    const distances = crowdingDistance(objectives, [0, 1, 2]);
    expect(distances[0]).toBe(Infinity);
    expect(distances[2]).toBe(Infinity);
    expect(Number.isFinite(distances[1])).toBe(true);
  });

  it("selects whole fronts first then the most spread candidates", () => {
    expect(selectByNsga2(objectives, 4).sort()).toEqual([0, 1, 2, 3]);
    expect(selectByNsga2(objectives, 2)).toHaveLength(2);
  });
});
