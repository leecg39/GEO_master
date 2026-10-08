import { describe, expect, it } from 'vitest';

import { normalizeUrl, registeredDomain } from '@/lib/geo-core';

describe('URL 정규화', () => {
  it('utm_* 추적 파라미터 제거', () => {
    const r = normalizeUrl('https://example.com/page?utm_source=x&utm_medium=y&id=1');
    expect(r.normalized).toBe('https://example.com/page?id=1');
    expect(r.domain).toBe('example.com');
  });

  it('gclid·fbclid 제거', () => {
    const r = normalizeUrl('https://a.com/p?gclid=zzz&fbclid=yyy&q=abc');
    expect(r.normalized).toBe('https://a.com/p?q=abc');
  });

  it('상품 식별 쿼리 보존', () => {
    const r = normalizeUrl('https://shop.com/item?product_id=42&color=red');
    expect(r.normalized).toContain('product_id=42');
    expect(r.normalized).toContain('color=red');
  });

  it('www. 제거 + 호스트 소문자화', () => {
    const r = normalizeUrl('https://WWW.Example.COM/Path');
    expect(r.domain).toBe('example.com');
  });

  it('프래그먼트 제거', () => {
    const r = normalizeUrl('https://a.com/p#section');
    expect(r.normalized).toBe('https://a.com/p');
  });

  it('스킴 없는 입력에 https 보강', () => {
    const r = normalizeUrl('example.com/page');
    expect(r.valid).toBe(true);
    expect(r.normalized.startsWith('https://')).toBe(true);
  });

  it('잘못된 URL은 valid=false', () => {
    expect(normalizeUrl('not a url !!').valid).toBe(false);
    expect(normalizeUrl('').valid).toBe(false);
    expect(normalizeUrl('ftp://x.com/f').valid).toBe(false);
  });

  it('등록 도메인 — 단순 TLD', () => {
    expect(registeredDomain('www.example.com')).toBe('example.com');
    expect(registeredDomain('a.b.example.com')).toBe('example.com');
  });

  it('등록 도메인 — 2단 TLD (co.kr 등)', () => {
    expect(registeredDomain('blog.example.co.kr')).toBe('example.co.kr');
    expect(registeredDomain('example.co.kr')).toBe('example.co.kr');
    expect(registeredDomain('shop.amazon.co.uk')).toBe('amazon.co.uk');
  });

  it('등록 도메인 — 등록 도메인 자체 입력', () => {
    expect(registeredDomain('naver.com')).toBe('naver.com');
  });
});
