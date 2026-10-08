/**
 * FeatGEO 다목적 최적화 루프 — (μ+λ) NSGA-II GA로 피처 설정을 탐색한다.
 * 목적: ① 인용 시뮬레이터에서 내 출처의 노출도(word·position 가중) ② 콘텐츠 품질.
 * 제약: 생성된 문안에 사실 메모로 뒷받침되지 않는 수치가 있으면 후보에서 제외한다(평가 호출도 하지 않는다).
 * 결과는 시뮬레이션 추정치이며 실제 AI 답변 측정과 합산하지 않는다.
 */
import { auditDraftText, type DraftFact } from "../geo-core";
import { factPromptBlock } from "../draft-evidence";
import { crossover, mutate, randomConfig, toGuidelines, type FeatureConfig } from "./feature-schema";
import { extractCitedSentences, impressionWordPos } from "./impression";
import {
  buildFusionPrompt, buildQualityPrompt, buildRewritePrompt, FUSION_SYSTEM, parseQualityScore, QUALITY_SYSTEM, REWRITE_SYSTEM,
  validateFusion, type Complete,
} from "./llm-steps";
import { paretoFront, selectByNsga2, tournamentSelect, type Objectives } from "./pareto";
import { profileText } from "./profile";
import { seededRandom } from "./rng";

export interface OptimizationInput {
  query: string;
  original: string;
  /** 경쟁 출처 본문 1~5개 */
  competitorSources: readonly string[];
  facts: readonly DraftFact[];
  allowedSources: readonly string[];
  quotes: readonly string[];
  competitorNames: readonly string[];
  popsize: number;
  generations: number;
  /** 시뮬레이터 반복 수 (노출도는 유효 답변 평균) */
  completions: number;
  seed: number;
  maxCalls?: number;
}

export interface Candidate {
  id: number;
  generation: number;
  config: FeatureConfig;
  text: string;
  feasible: boolean;
  flaggedSentences: string[];
  visibility: number | null;
  quality: number | null;
  sampleAnswer: string | null;
}

export interface OptimizationResult {
  baseline: { profile: FeatureConfig; visibility: number; quality: number | null; sampleAnswer: string | null };
  candidates: Candidate[];
  paretoIds: number[];
  recommendedId: number | null;
  callsUsed: number;
  stoppedReason: "completed" | "budget" | "canceled";
}

export interface OptimizationDeps {
  complete: Complete;
  shouldCancel?: () => boolean;
  onProgress?: (progress: { evaluated: number; total: number; callsUsed: number }) => void;
}

/** 원본 가중 점수(노출 0.8 + 품질 0.2) — Pareto 전선에서 추천 후보를 고를 때만 쓴다 */
const VISIBILITY_WEIGHT = 0.8;
const QUALITY_WEIGHT = 0.2;
const INFEASIBLE: Objectives = [-1, -1];

export function estimateOptimizationCalls(input: Pick<OptimizationInput, "popsize" | "generations" | "completions">) {
  const perEvaluation = input.completions + 1;
  return perEvaluation + input.popsize * (1 + input.generations) * (1 + perEvaluation);
}

class BudgetExceeded extends Error {}
class Canceled extends Error {}

function createRunner(input: OptimizationInput, deps: OptimizationDeps) {
  let callsUsed = 0;
  const maxCalls = input.maxCalls ?? Infinity;
  const call: Complete = async (request) => {
    if (deps.shouldCancel?.()) throw new Canceled();
    callsUsed += 1;
    return deps.complete(request);
  };
  const ensureBudget = (needed: number) => {
    if (callsUsed + needed > maxCalls) throw new BudgetExceeded();
  };
  return { call, ensureBudget, used: () => callsUsed };
}

type Runner = ReturnType<typeof createRunner>;

async function evaluateText(text: string, input: OptimizationInput, runner: Runner) {
  const sources = [...input.competitorSources, text];
  const target = sources.length;
  const shares: number[] = [];
  let sampleAnswer: string | null = null;
  for (let attempt = 0; attempt < input.completions; attempt += 1) {
    const answer = await runner.call({ system: FUSION_SYSTEM, prompt: buildFusionPrompt(input.query, sources), maxTokens: 1_200 });
    if (!validateFusion(answer, target)) continue;
    sampleAnswer ??= answer;
    shares.push(impressionWordPos(extractCitedSentences(answer), target)[target - 1]!);
  }
  const visibility = shares.length ? shares.reduce((sum, value) => sum + value, 0) / shares.length : 0;
  const qualityOutput = await runner.call({ system: QUALITY_SYSTEM, prompt: buildQualityPrompt(text, input.query, sampleAnswer), maxTokens: 300 });
  return { visibility, quality: parseQualityScore(qualityOutput, Boolean(sampleAnswer && sampleAnswer.length > 50)), sampleAnswer };
}

async function evaluateCandidate(id: number, generation: number, config: FeatureConfig, input: OptimizationInput, runner: Runner): Promise<Candidate> {
  runner.ensureBudget(input.completions + 2);
  const guidelines = toGuidelines(config, { hasFacts: input.facts.some((fact) => fact.usable), allowedSources: input.allowedSources, quotes: input.quotes });
  const text = (await runner.call({
    system: REWRITE_SYSTEM,
    prompt: buildRewritePrompt({ query: input.query, original: input.original, guidelines, factsBlock: factPromptBlock(input.facts) }),
    maxTokens: 2_000,
  })).trim();
  const audit = auditDraftText(text, input.facts, input.competitorNames);
  const flaggedSentences = audit.sentences.filter((sentence) => sentence.check === "needs_evidence").map((sentence) => sentence.text);
  if (!text || flaggedSentences.length) {
    return { id, generation, config, text, feasible: false, flaggedSentences, visibility: null, quality: null, sampleAnswer: null };
  }
  const scores = await evaluateText(text, input, runner);
  return { id, generation, config, text, feasible: true, flaggedSentences, ...scores };
}

function objectivesOf(candidate: Candidate): Objectives {
  return candidate.feasible ? [candidate.visibility ?? 0, candidate.quality ?? 0] : INFEASIBLE;
}

function recommend(candidates: readonly Candidate[], paretoIds: readonly number[]) {
  const pool = candidates.filter((candidate) => paretoIds.includes(candidate.id));
  const scored = pool.map((candidate) => ({
    id: candidate.id,
    score: VISIBILITY_WEIGHT * (candidate.visibility ?? 0) + QUALITY_WEIGHT * (candidate.quality ?? 0),
  }));
  return scored.sort((a, b) => b.score - a.score)[0]?.id ?? null;
}

function finalize(baseline: OptimizationResult["baseline"], candidates: Candidate[], callsUsed: number, stoppedReason: OptimizationResult["stoppedReason"]): OptimizationResult {
  const feasible = candidates.filter((candidate) => candidate.feasible);
  const paretoIds = paretoFront(feasible.map(objectivesOf)).map((index) => feasible[index]!.id);
  return { baseline, candidates, paretoIds, recommendedId: recommend(candidates, paretoIds), callsUsed, stoppedReason };
}

async function evolve(input: OptimizationInput, runner: Runner, candidates: Candidate[], deps: OptimizationDeps) {
  const random = seededRandom(input.seed);
  const total = input.popsize * (1 + input.generations);
  const record = (candidate: Candidate) => {
    candidates.push(candidate);
    deps.onProgress?.({ evaluated: candidates.length, total, callsUsed: runner.used() });
    return candidate;
  };
  const initialConfigs = [profileText(input.original), ...Array.from({ length: input.popsize - 1 }, () => randomConfig(random))];
  let population: Candidate[] = [];
  for (const config of initialConfigs) population.push(record(await evaluateCandidate(candidates.length + 1, 0, config, input, runner)));
  for (let generation = 1; generation <= input.generations; generation += 1) {
    const objectives = population.map(objectivesOf);
    const offspring: Candidate[] = [];
    for (let index = 0; index < input.popsize; index += 1) {
      const parentA = population[tournamentSelect(objectives, random)]!.config;
      const parentB = population[tournamentSelect(objectives, random)]!.config;
      const child = mutate(crossover(parentA, parentB, random), random);
      offspring.push(record(await evaluateCandidate(candidates.length + 1, generation, child, input, runner)));
    }
    const combined = [...population, ...offspring];
    population = selectByNsga2(combined.map(objectivesOf), input.popsize).map((index) => combined[index]!);
  }
}

export async function runFeatureOptimization(input: OptimizationInput, deps: OptimizationDeps): Promise<OptimizationResult> {
  const runner = createRunner(input, deps);
  const profile = profileText(input.original);
  runner.ensureBudget(input.completions + 1);
  const baselineScores = await evaluateText(input.original, input, runner);
  const baseline = { profile, ...baselineScores };
  const candidates: Candidate[] = [];
  try {
    await evolve(input, runner, candidates, deps);
    return finalize(baseline, candidates, runner.used(), "completed");
  } catch (error) {
    if (error instanceof BudgetExceeded) return finalize(baseline, candidates, runner.used(), "budget");
    if (error instanceof Canceled) return finalize(baseline, candidates, runner.used(), "canceled");
    throw error;
  }
}
