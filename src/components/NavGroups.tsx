import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BarChart3, BookOpen, Braces, CalendarClock, ChevronDown, ClipboardCheck, FileCode2, FileDown, FilePenLine, FileSpreadsheet, FlaskConical,
  Gauge, GitCompare, Images, ListChecks, PackageOpen, SearchCheck, Target, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 왼쪽 메뉴 묶음. AppShell(클라이언트 컴포넌트) 안에서만 쓴다.
 * label이 null인 묶음은 펼침 버튼 없이 바로 링크를 보여 준다(대시보드).
 */
export interface NavItem { href: string; label: string; icon: typeof Gauge }
export interface NavGroupConfig { id: string; label: string | null; icon: typeof Gauge; items: readonly NavItem[] }

export const CORE_NAV_GROUPS: readonly NavGroupConfig[] = [
  { id: "home", label: null, icon: Gauge, items: [{ href: "/", label: "대시보드", icon: Gauge }] },
  { id: "measure", label: "AI 노출 측정", icon: Target, items: [
    { href: "/monitoring", label: "AI 언급 모니터링", icon: Target },
    { href: "/share", label: "응답 점유율", icon: BarChart3 },
    { href: "/automation", label: "예약 측정", icon: CalendarClock },
  ] },
  { id: "diagnose", label: "사이트 진단", icon: SearchCheck, items: [
    { href: "/audit", label: "GEO 진단", icon: SearchCheck },
    { href: "/multimodal", label: "멀티모달 감사", icon: Images },
    { href: "/structured-data", label: "구조화 데이터", icon: Braces },
    { href: "/llms", label: "llms.txt", icon: FileCode2 },
  ] },
  { id: "improve", label: "콘텐츠 개선", icon: Wrench, items: [
    { href: "/changes", label: "수정안 작업대", icon: GitCompare },
    { href: "/studio", label: "콘텐츠 스튜디오", icon: FilePenLine },
    { href: "/optimizer", label: "최적화 랩", icon: FlaskConical },
    { href: "/facts", label: "사실 메모", icon: ClipboardCheck },
    { href: "/review", label: "검수함", icon: ListChecks },
  ] },
  { id: "reports", label: "리포트·데이터", icon: FileDown, items: [
    { href: "/reports", label: "리포트", icon: FileDown },
    { href: "/search-console", label: "검색 성과 가져오기", icon: FileSpreadsheet },
    { href: "/workspace", label: "팀 공유", icon: PackageOpen },
  ] },
  { id: "strategy", label: "전략·학습", icon: BookOpen, items: [
    { href: "/strategy", label: "전략 워크스페이스", icon: Target },
    { href: "/learn", label: "학습 센터", icon: BookOpen },
  ] },
];

export const NAV_GROUPS_STORAGE_KEY = "geo-master:nav-groups";

export const isActiveHref = (href: string, pathname: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function activeGroupId(pathname: string) {
  return CORE_NAV_GROUPS.find((group) => group.label && group.items.some((item) => isActiveHref(item.href, pathname)))?.id ?? null;
}

const listeners = new Set<() => void>();
/** 브라우저 저장소에 쓸 수 없을 때(사생활 보호 모드·할당량 초과 등) 쓰는 메모리 값 */
let memoryFallback: string | null = null;

function readRaw() {
  try {
    const stored = window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY);
    if (stored !== null) {
      memoryFallback = null;
      return stored;
    }
    return memoryFallback ?? "{}";
  } catch {
    return memoryFallback ?? "{}";
  }
}

function writeRaw(value: string) {
  try {
    window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, value);
    memoryFallback = null;
  } catch {
    memoryFallback = value;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { listeners.delete(listener); window.removeEventListener("storage", listener); };
}

function parseSaved(raw: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

/**
 * 펼침 상태
 * - 현재 페이지가 들어 있는 묶음은 늘 펼친다. 사용자가 그 페이지에 있는 동안 직접 접으면 접는다(다른 페이지로 가면 다시 판단)
 * - 다른 묶음은 사용자가 정한 값을 브라우저에 기억한다(서버 렌더링 때는 모두 접힘 → 하이드레이션 불일치 없음)
 */
export function useNavGroupState(pathname: string) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "{}");
  const saved = useMemo(() => parseSaved(raw), [raw]);
  const [collapsedActive, setCollapsedActive] = useState<{ id: string; pathname: string } | null>(null);
  const active = activeGroupId(pathname);
  const activeCollapsed = collapsedActive !== null && collapsedActive.id === active && collapsedActive.pathname === pathname;

  const isExpanded = useCallback((id: string) => (id === active ? !activeCollapsed : saved[id] ?? false), [active, activeCollapsed, saved]);
  const toggle = useCallback((id: string) => {
    if (id === active) {
      setCollapsedActive(activeCollapsed ? null : { id, pathname });
      return;
    }
    writeRaw(JSON.stringify({ ...saved, [id]: !(saved[id] ?? false) }));
  }, [active, activeCollapsed, pathname, saved]);
  return { isExpanded, toggle, active };
}

export function NavGroup({ id, label, icon: Icon, expanded, containsActive, onToggle, children }: {
  id: string; label: string; icon: typeof Gauge; expanded: boolean; containsActive: boolean; onToggle: () => void; children: ReactNode;
}) {
  const panelId = `nav-group-${id}`;
  return (
    <div data-nav-group={id} className="pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.04em] transition hover:bg-white/5 hover:text-white",
          containsActive ? "text-white" : "text-[color:var(--color-on-dark-muted)]",
        )}
      >
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--color-accent-violet-mid)]" />
        <span className="flex-1">{label}</span>
        {containsActive && !expanded && <span data-active-dot aria-label="현재 페이지 포함" className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-accent-lime)]" />}
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>
      <div id={panelId} hidden={!expanded} className="mt-1 space-y-1 border-l border-[color:var(--color-hairline-violet)] pl-2 ml-5">
        {children}
      </div>
    </div>
  );
}
