interface Choice { id: number }
interface Choices { documents: readonly Choice[]; profiles: readonly Choice[]; opportunities: readonly Choice[] }

/** Historical snapshots remain intact; only live resources can be selected for a new request. */
export function liveStudioSelection(input: Record<string, unknown>, choices: Choices) {
  const selected = (value: unknown, list: readonly Choice[]) => typeof value === "number" && list.some(item => item.id === value) ? String(value) : "";
  const ids = Array.isArray(input.knowledgeDocumentIds) ? input.knowledgeDocumentIds : [];
  return {
    opportunityId: selected(input.opportunityId, choices.opportunities),
    writingProfileId: selected(input.writingProfileId, choices.profiles),
    knowledgeDocumentIds: [...new Set(ids.filter((value): value is number => typeof value === "number" && choices.documents.some(item => item.id === value)))].slice(0, 5),
  };
}
