// Ported from leecg39/GEO_master2 packages/core/src/sources/classify.ts

import { registeredDomain } from '../url-normalize';

import { DOMAIN_CATEGORY_RULES, SUBDOMAIN_CATEGORY_RULES, type SourceCategory } from './rules';

export interface SourceClassification {
  category: SourceCategory;
  /** 자사/경쟁사 도메인 매칭 시 해당 엔티티 */
  competitorEntityId: string | null;
}

/**
 * 인용 도메인 분류 (TRD §9).
 * 우선순위: 자사 도메인 → 경쟁사 도메인 → 사전 규칙 → other
 */
export function classifySource(
  host: string,
  options: {
    ownDomains: readonly string[];
    competitorDomains: ReadonlyArray<{ entityId: string; domains: readonly string[] }>;
  },
): SourceClassification {
  const lower = host.toLowerCase();
  const reg = registeredDomain(lower);

  const ownSet = new Set(options.ownDomains.map((d) => registeredDomain(d)));
  if (ownSet.has(reg)) {
    return { category: 'own', competitorEntityId: null };
  }

  for (const comp of options.competitorDomains) {
    const compSet = new Set(comp.domains.map((d) => registeredDomain(d)));
    if (compSet.has(reg)) {
      return { category: 'competitor', competitorEntityId: comp.entityId };
    }
  }

  const sub = SUBDOMAIN_CATEGORY_RULES[lower];
  if (sub) return { category: sub, competitorEntityId: null };

  const rule = DOMAIN_CATEGORY_RULES[reg] ?? DOMAIN_CATEGORY_RULES[lower];
  return { category: rule ?? 'other', competitorEntityId: null };
}
