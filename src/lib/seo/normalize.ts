import { createHash } from "node:crypto";

export const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
export const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, val]) => `${JSON.stringify(key)}:${stableJson(val)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Flatten graph containers, retaining inherited contexts and typed graph nodes. */
export function schemaEntities(values: unknown[], context?: unknown): Record<string, unknown>[] {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return schemaEntities(value, context);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const inherited = record["@context"] ?? context;
    const { "@graph": graph, ...entity } = record;
    const own = { ...(inherited ? { "@context": inherited } : {}), ...entity };
    return Array.isArray(graph)
      ? [...(record["@type"] ? [own] : []), ...schemaEntities(graph, inherited)]
      : [own];
  });
}
export function schemaTypes(entity: Record<string, unknown>): string[] {
  const value = entity["@type"];
  return (Array.isArray(value) ? value : [value]).filter((type): type is string => typeof type === "string" && type.trim().length > 0);
}

export function normalizeRobots(value: string) {
  return value.toLowerCase().split(/[,\s]+/).filter(Boolean).sort().join(",");
}

/** Object key order is noise; ordered schema lists and URL identity are preserved. */
export function equalSeoValue(field: string, left: string, right: string) {
  if (field === "jsonLd") {
    try {
      return stableJson(schemaEntities([JSON.parse(left)])) === stableJson(schemaEntities([JSON.parse(right)]));
    } catch { return false; }
  }
  if (field === "robots" || field === "robotsHeader") return normalizeRobots(left) === normalizeRobots(right);
  return normalizeText(left) === normalizeText(right);
}
