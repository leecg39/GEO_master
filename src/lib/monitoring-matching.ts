import { createHash } from "node:crypto";
import { buildDictionary, matchBrands, normalizeAlias } from "./geo-core";

export function monitoringQuestionKey(text: string) { return createHash("sha256").update(text).digest("hex"); }

/** Shared by aggregate metrics and response evidence, using the current project dictionary. */
export function monitoringMatcher(project: { brandName: string; brandAliases: string[]; competitors: string[] }) {
  const names = new Set([normalizeAlias(project.brandName)]);
  const brands = [
    { id: "own", name: project.brandName, own: true },
    ...project.competitors.flatMap((raw) => {
      const name = raw.trim();
      const normalized = normalizeAlias(name);
      if ([...name].length < 2 || !normalized || names.has(normalized)) return [];
      names.add(normalized);
      return [{ id: `b_${monitoringQuestionKey(normalized).slice(0, 16)}`, name, own: false }];
    }),
  ];
  const entities = brands.map((brand) => ({
    ...brand, kind: brand.own ? "brand" as const : "competitor" as const,
    aliases: brand.own ? project.brandAliases.filter((alias) => [...alias.trim()].length >= 2).map((alias) => ({ alias, ambiguous: false })) : [],
  }));
  const dictionary = buildDictionary(entities);
  return { brands, match: (text: string) => matchBrands(text, dictionary, entities) };
}
