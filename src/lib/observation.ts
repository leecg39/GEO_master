export type ObservationMode = "model_only" | "web_search" | "serp_snapshot";
export interface MeasurementConditions {
  mode: ObservationMode;
  dataState: "live" | "mock";
  questionSetHash: string;
  modelConfigHash: string;
  repetitions: number;
  language: string;
  country: string | null;
  promptVersion: string;
}
export function measurementConditions(
  summary: string,
): MeasurementConditions | null {
  try {
    const value = JSON.parse(summary).measurementConditions;
    return value &&
      ["model_only", "web_search", "serp_snapshot"].includes(value.mode) &&
      typeof value.questionSetHash === "string" &&
      typeof value.modelConfigHash === "string" &&
      typeof value.repetitions === "number" &&
      typeof value.language === "string" &&
      (value.country === null || typeof value.country === "string") &&
      typeof value.promptVersion === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export function comparableMeasurements(left: string, right: string) {
  const a = measurementConditions(left);
  const b = measurementConditions(right);
  return Boolean(
    a &&
      b &&
      a.dataState === "live" &&
      b.dataState === "live" &&
      a.mode === b.mode &&
      a.questionSetHash === b.questionSetHash &&
      a.modelConfigHash === b.modelConfigHash &&
      a.repetitions === b.repetitions &&
      a.language === b.language &&
      a.country === b.country &&
      a.promptVersion === b.promptVersion,
  );
}
