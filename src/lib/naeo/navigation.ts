import type { LucideIcon } from "lucide-react";
import { FilePenLine, GitCompare, SearchCheck, Sparkles, TrendingUp } from "lucide-react";

export const NAEO_HUB_PATH = "/naeo";
export const NAEO_REPO_URL = "https://github.com/leecg39/Naeo";

export interface NaeoFeature {
  label: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Naeo(leecg39/Naeo) 워크스페이스 기능. Naeo는 자체 로그인·DB를 가진 별도 앱이라
 * GEO Master에서는 소개와 실행 진입만 제공하고, 실제 작업은 Naeo 화면에서 한다.
 */
export const naeoFeatures: NaeoFeature[] = [
  {
    label: "블로그 진단",
    description: "네이버 RSS를 수집해 rules-v1 기준으로 진단·근거·할 일을 만들고 리포트 공유까지 연결합니다.",
    icon: SearchCheck,
  },
  {
    label: "키워드·AI 인용 확인",
    description: "키워드 상위 노출과 네이버 직접 조회 또는 SerpApi를 통한 AI 인용 여부를 확인합니다.",
    icon: TrendingUp,
  },
  {
    label: "메이트 재진단",
    description: "최근 글 본문을 수집해 LLM 또는 규칙으로 5기준을 판정하고 8장 카드와 재진단을 제공합니다.",
    icon: Sparkles,
  },
  {
    label: "경쟁 블로그 비교",
    description: "키워드·추천·경쟁 블로그를 자동 탐색해 내 블로그와 나란히 비교합니다.",
    icon: GitCompare,
  },
  {
    label: "AI 글·이미지 작성",
    description: "초안·템플릿 위에서 AI 글 생성과 AI 이미지 생성을 작업 큐로 실행합니다.",
    icon: FilePenLine,
  },
];
