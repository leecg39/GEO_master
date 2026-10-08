import type { LucideIcon } from "lucide-react";
import { BarChart3, Globe2, MapPin, SearchCheck, TrendingUp } from "lucide-react";

export const SEMFORGE_HUB_PATH = "/semforge";

export interface SemforgeFeature {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const semforgeFeatures: SemforgeFeature[] = [
  {
    href: "/ai-seo",
    label: "AI SEO (SERP)",
    description: "TalorData 실측 SERP로 Google AI Overview 출현·자사 도메인 인용을 추적합니다.",
    icon: Globe2,
  },
  {
    href: "/site-audit",
    label: "사이트 진단",
    description: "Firecrawl 기반 크롤로 기술 SEO·AI 검색 신호를 점검합니다.",
    icon: SearchCheck,
  },
  {
    href: "/position-tracking",
    label: "포지션 추적",
    description: "키워드별 SERP 순위 변화를 캠페인 단위로 모니터링합니다.",
    icon: TrendingUp,
  },
  {
    href: "/analytics/overview",
    label: "도메인 개요",
    description: "포지션 추적·사이트 진단·GSC 연결 상태를 도메인 기준으로 요약합니다.",
    icon: BarChart3,
  },
  {
    href: "/local-business",
    label: "지역 SEO",
    description: "Google Business Profile 연결과 Local Pack Map Rank 키워드 추적.",
    icon: MapPin,
  },
];

export const semforgePaths = [SEMFORGE_HUB_PATH, ...semforgeFeatures.map((feature) => feature.href)];

export function isSemforgePath(pathname: string): boolean {
  return semforgePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
