import { describe, expect, it } from 'vitest';

import { classifySource, normalizeUrl } from '@/lib/geo-core';

describe('출처 분류', () => {
  const opts = {
    ownDomains: ['gasang.kr'],
    competitorDomains: [
      { entityId: 'comp-1', domains: ['hanssem.com'] },
      { entityId: 'comp-2', domains: ['ikea.com'] },
    ],
  };
  const classify = (url: string) =>
    classifySource(normalizeUrl(url).domain, opts);

  it('자사 도메인 → own', () => {
    expect(classify('https://www.gasang.kr/page').category).toBe('own');
    expect(classify('https://blog.gasang.kr/post').category).toBe('own');
  });

  it('경쟁사 도메인 → competitor + entity 매핑', () => {
    const r = classify('https://hanssem.com/product/1');
    expect(r.category).toBe('competitor');
    expect(r.competitorEntityId).toBe('comp-1');
  });

  it('사전 규칙 — YouTube는 media', () => {
    expect(classify('https://www.youtube.com/watch?v=x').category).toBe('media');
  });

  it('사전 규칙 — Reddit은 community', () => {
    expect(classify('https://reddit.com/r/furniture').category).toBe('community');
  });

  it('서브도메인 세분류 — blog.naver.com은 media', () => {
    expect(classify('https://blog.naver.com/user/123').category).toBe('media');
  });

  it('미분류 도메인 → other', () => {
    expect(classify('https://random-site-12345.com/x').category).toBe('other');
  });
});

