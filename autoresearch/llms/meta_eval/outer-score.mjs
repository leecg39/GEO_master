// Frozen outer metric: the least reliable category determines strategy progress.
export function outerScore(groups) {
  const categories = ['storage', 'history', 'remote', 'preview', 'freshness', 'project'];
  if (categories.some(category => !groups[category]?.total)) throw new Error('Missing category');
  return Math.min(...categories.map(category => groups[category].passed / groups[category].total * 100));
}
