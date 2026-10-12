/**
 * llms.txt 편집 화면의 "핵심 문서" 입력 형식 (A6).
 * 한 줄에 "제목 | 절대 URL | 설명". "## 제목" 줄이 있으면 그 아래 줄을 새 섹션으로 묶는다.
 * 섹션 줄이 없으면 예전처럼 모두 "핵심 문서" 섹션 하나가 된다. 화면과 서버가 함께 쓰는 순수 함수다.
 */
export interface ResourceLink { title: string; url: string; description: string }
export interface ResourceSection { heading: string; links: ResourceLink[] }

export const DEFAULT_SECTION_HEADING = "핵심 문서";

export function parseResourceLines(text: string): ResourceSection[] {
  const sections: ResourceSection[] = [];
  let current: ResourceSection = { heading: DEFAULT_SECTION_HEADING, links: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      sections.push(current);
      current = { heading: line.slice(3).trim() || DEFAULT_SECTION_HEADING, links: [] };
      continue;
    }
    const [title = "", url = "", description = ""] = line.split("|").map((part) => part.trim());
    current = { ...current, links: [...current.links, { title, url, description }] };
  }
  return [...sections, current].filter((section) => section.links.length > 0);
}

export function formatResourceLines(sections: readonly ResourceSection[]) {
  return sections.map((section) => [
    `## ${section.heading}`,
    ...section.links.map((link) => [link.title, link.url, link.description].filter((part, index) => index < 2 || part).join(" | ")),
  ].join("\n")).join("\n\n");
}
