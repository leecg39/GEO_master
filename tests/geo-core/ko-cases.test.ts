import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDictionary, matchBrands, normalizeAlias, normalizeText } from '@/lib/geo-core';

interface GoldenCase {
  id: string;
  text: string;
  mentioned?: string[];
  counts?: Record<string, number>;
  firstOrder?: string[];
  domainHits?: string[];
  ambiguous?: string[];
  note?: string;
}

interface GoldenSet {
  entities: Array<{
    id: string;
    name: string;
    kind: 'brand' | 'product' | 'competitor';
    officialDomains?: string[];
    aliases: Array<{ alias: string; ambiguous: boolean }>;
  }>;
  cases: GoldenCase[];
}

const golden = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/geo-core/ko-cases.json'), 'utf8'),
) as GoldenSet;

const dictionary = buildDictionary(golden.entities);

describe('한국어 브랜드 식별 골든 세트', () => {
  it('골든 세트가 60건 이상이다', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(60);
  });

  for (const c of golden.cases) {
    it(c.id + (c.note ? ` — ${c.note}` : ''), () => {
      const result = matchBrands(c.text, dictionary, golden.entities);

      // 언급된 엔티티 집합
      const mentionedIds = [...new Set(result.mentions.map((m) => m.entityId))].sort();
      expect(mentionedIds, `case ${c.id}`).toEqual([...(c.mentioned ?? [])].sort());

      // 엔티티별 언급 횟수
      if (c.counts) {
        for (const [entityId, n] of Object.entries(c.counts)) {
          expect(
            result.mentions.filter((m) => m.entityId === entityId).length,
            `${c.id} ${entityId} count`,
          ).toBe(n);
        }
      }

      // 첫 등장 순서
      if (c.firstOrder) {
        const order = [...result.firstPositions.entries()]
          .sort((a, b) => a[1] - b[1])
          .map(([id]) => id);
        expect(order, `${c.id} firstOrder`).toEqual(c.firstOrder);
      }

      // 도메인 히트
      if (c.domainHits !== undefined) {
        const hitIds = [...new Set(result.domainHits.map((h) => h.entityId))].sort();
        expect(hitIds, `${c.id} domainHits`).toEqual([...c.domainHits].sort());
      }

      // 모호 플래그
      if (c.ambiguous !== undefined) {
        const ambIds = [
          ...new Set(result.mentions.filter((m) => m.ambiguous).map((m) => m.entityId)),
        ].sort();
        expect(ambIds, `${c.id} ambiguous`).toEqual([...c.ambiguous].sort());
      }

      // 원문 오프셋 — 역변환한 구간을 정규화하면 별칭과 일치해야 한다
      for (const m of result.mentions) {
        const span = normalizeText(c.text.slice(m.start, m.end)).text;
        expect(
          span,
          `${c.id} span '${c.text.slice(m.start, m.end)}' ≠ alias '${m.matchedAlias}'`,
        ).toBe(normalizeAlias(m.matchedAlias));
      }
    });
  }
});
