// Ported from leecg39/GEO_master2 packages/core/src/matching/dictionary.ts
import { normalizeAlias } from './normalize';

/** 별칭 사전 — 매칭 입력 (엔티티·별칭은 서비스 계층에서 주입) */
export interface AliasEntry {
  entityId: string;
  entityName: string;
  kind: 'brand' | 'product' | 'competitor';
  alias: string;
  aliasNormalized: string;
  ambiguous: boolean;
}

export interface DictionaryEntry extends AliasEntry {
  length: number;
}

export function buildDictionary(
  entities: Array<{
    id: string;
    name: string;
    kind: 'brand' | 'product' | 'competitor';
    officialDomains?: string[];
    aliases: Array<{ alias: string; aliasNormalized?: string; ambiguous: boolean }>;
  }>,
): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const aliasOwners = new Map<string, Set<string>>();

  for (const e of entities) {
    const seen = new Set<string>();
    // 엔티티 이름 자체도 별칭으로 취급
    const allAliases = [
      { alias: e.name, ambiguous: false, aliasNormalized: undefined as string | undefined },
      ...e.aliases,
    ];
    for (const a of allAliases) {
      const norm = a.aliasNormalized ?? normalizeAlias(a.alias);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      // 다른 엔티티와 같은 정규화 별칭 → 충돌 = ambiguous로 승격
      const owners = aliasOwners.get(norm) ?? new Set<string>();
      owners.add(e.id);
      aliasOwners.set(norm, owners);
      entries.push({
        entityId: e.id,
        entityName: e.name,
        kind: e.kind,
        alias: a.alias,
        aliasNormalized: norm,
        ambiguous: a.ambiguous,
        length: [...norm].length,
      });
    }
  }

  for (const entry of entries) {
    const owners = aliasOwners.get(entry.aliasNormalized);
    if (owners && owners.size > 1) entry.ambiguous = true;
  }

  // 최장 일치 우선
  return entries.sort((a, b) => b.length - a.length);
}
