// Frozen outer metric: the weakest category bounds strategy progress.
export const CATEGORIES = ["security", "a11y", "flow", "structured", "admin"];

export function outerScore(groups) {
  if (CATEGORIES.some((category) => !groups[category]?.total)) throw new Error("Missing category");
  return Math.min(...CATEGORIES.map((category) => (groups[category].passed / groups[category].total) * 100));
}
