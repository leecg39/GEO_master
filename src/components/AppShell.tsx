"use client";

import type { RequestAccount } from "@/lib/request-account";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart3, BookOpen, Bot, CalendarClock, ArrowLeft, ExternalLink, ClipboardCheck, GitCompare, Braces, FileSpreadsheet, FlaskConical, ListChecks, CreditCard, FileCode2, FileDown, FilePenLine, Gauge, Images, LoaderCircle, Menu, PackageOpen, SearchCheck, Settings, Sparkles, Target, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isSemforgePath, SEMFORGE_HUB_PATH, SEMFORGE_SUBSCRIPTION_PATH, semforgeFeatures } from "@/lib/semforge/navigation";
import { cn } from "@/lib/utils";

const coreNavigation = [
  { href: "/", label: "대시보드", icon: Gauge },
  { href: "/monitoring", label: "AI 언급 모니터링", icon: Target },
  { href: "/audit", label: "GEO 진단", icon: SearchCheck },
  { href: "/multimodal", label: "멀티모달 감사", icon: Images },
  { href: "/llms", label: "llms.txt", icon: FileCode2 },
  { href: "/share", label: "응답 점유율", icon: BarChart3 },
  { href: "/automation", label: "예약 측정", icon: CalendarClock },
  { href: "/reports", label: "리포트", icon: FileDown },
  { href: "/review", label: "검수함", icon: ListChecks },
  { href: "/facts", label: "사실 메모", icon: ClipboardCheck },
  { href: "/changes", label: "수정안 작업대", icon: GitCompare },
  { href: "/structured-data", label: "구조화 데이터", icon: Braces },
  { href: "/search-console", label: "검색 성과 가져오기", icon: FileSpreadsheet },
  { href: "/studio", label: "콘텐츠 스튜디오", icon: FilePenLine },
  { href: "/optimizer", label: "최적화 랩", icon: FlaskConical },
  { href: "/strategy", label: "전략 워크스페이스", icon: Target },
  { href: "/learn", label: "학습 센터", icon: BookOpen },
  { href: "/workspace", label: "팀 공유", icon: PackageOpen },
];

const subscriptionNavigation = { href: "/subscription", label: "SEMForge Pro", icon: CreditCard };

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  close,
  newTab,
}: {
  href: string;
  label: string;
  icon: typeof Gauge;
  active: boolean;
  close?: () => void;
  newTab?: boolean;
}) {
  return (
    <Link
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      title={newTab ? `${label} (새 탭에서 열기)` : undefined}
      aria-current={active ? "page" : undefined}
      onClick={close}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
        active
          ? "bg-[color:var(--color-accent-lime)]/12 text-[color:var(--color-accent-lime)]"
          : "text-[color:var(--color-on-dark-muted)] hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className={cn("h-4.5 w-4.5 shrink-0", active ? "text-[color:var(--color-accent-lime)]" : "text-[color:var(--color-accent-violet-mid)] group-hover:text-white")} />
      {label}
      {newTab && <><ExternalLink aria-hidden="true" className="ml-auto h-3.5 w-3.5 shrink-0" /><span className="sr-only"> (새 탭에서 열기)</span></>}
    </Link>
  );
}

function Navigation({ close, semforgeActive, guest }: { close?: () => void; semforgeActive: boolean | null; guest: boolean }) {
  const pathname = usePathname();

  if (!guest && isSemforgePath(pathname)) {
    return (
      <nav className="mt-8 space-y-1.5" aria-label="SEMForge 메뉴">
        <NavLink href={SEMFORGE_HUB_PATH} label="워크스페이스" icon={Sparkles} active={pathname === SEMFORGE_HUB_PATH} close={close} />
        {semforgeFeatures.map(({ href, label, icon }) => (
          <NavLink key={href} href={href} label={label} icon={icon} active={pathname === href || pathname.startsWith(`${href}/`)} close={close} />
        ))}
        <div className="mt-4 border-t border-[color:var(--color-hairline-violet)] pt-4">
          <NavLink href={SEMFORGE_SUBSCRIPTION_PATH} label="구독 관리" icon={CreditCard} active={pathname === SEMFORGE_SUBSCRIPTION_PATH} close={close} />
        </div>
      </nav>
    );
  }

  return (
    <nav className="mt-8 space-y-1.5" aria-label="주요 메뉴">
      {coreNavigation.filter((item) => !guest || !["/workspace", "/search-console"].includes(item.href)).map(({ href, label, icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return <NavLink key={href} href={href} label={label} icon={icon} active={active} close={close} />;
      })}

      {!guest && (semforgeActive === null ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500">
          <LoaderCircle className="h-4.5 w-4.5 animate-spin" />
          SEMForge 확인 중
        </div>
      ) : (
        <div className="pt-2">
          <NavLink
            href={semforgeActive ? SEMFORGE_HUB_PATH : subscriptionNavigation.href}
            label={subscriptionNavigation.label}
            icon={subscriptionNavigation.icon}
            active={!semforgeActive && pathname === subscriptionNavigation.href}
            newTab={semforgeActive}
            close={close}
          />
        </div>
      ))}

      {!guest && <div className="pt-2">
        <NavLink
          href="/settings"
          label="설정"
          icon={Settings}
          active={pathname.startsWith("/settings")}
          close={close}
        />
      </div>}
    </nav>
  );
}

function Brand({ close, semforge }: { close?: () => void; semforge: boolean }) {
  const Icon = semforge ? Sparkles : Bot;
  return (
    <Link href={semforge ? SEMFORGE_HUB_PATH : "/"} onClick={close} className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[color:var(--color-accent-lime)] text-[color:var(--color-ink-deep)]">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <strong className="font-display block text-base font-semibold tracking-tight text-white">{semforge ? "SEMForge Pro" : "GEO Master"}</strong>
        <small className="text-[10px] font-semibold uppercase tracking-[0.25px] text-[color:var(--color-on-dark-muted)]">{semforge ? "SEO workspace" : "Answer workspace"}</small>
      </span>
    </Link>
  );
}

export function AppShell({ children, account }: { children: ReactNode; account?: RequestAccount }) {
  const guest = account?.role === "guest";
  const pathname = usePathname();
  const semforge = !guest && isSemforgePath(pathname);
  const [open, setOpen] = useState(false);
  const menuTitleId = useId();
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (desktop.matches) setOpen(false); };
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, []);
  const [semforgeActive, setSemforgeActive] = useState<boolean | null>(null);

  useEffect(() => {
    if (guest) return;
    let active = true;
    let latestRequest = 0;
    async function refreshSubscription() {
      const requestId = ++latestRequest;
      try {
        const response = await fetch("/api/semforge/subscription");
        if (!response.ok) throw new Error("구독 조회 실패");
        const data = await response.json() as { subscription?: { active?: boolean } };
        if (active && requestId === latestRequest) setSemforgeActive(Boolean(data.subscription?.active));
      } catch {
        if (active && requestId === latestRequest) setSemforgeActive(false);
      }
    }
    void refreshSubscription();
    window.addEventListener("geo-master:subscription-changed", refreshSubscription);
    window.addEventListener("focus", refreshSubscription);
    return () => {
      active = false;
      window.removeEventListener("geo-master:subscription-changed", refreshSubscription);
      window.removeEventListener("focus", refreshSubscription);
    };
  }, [guest, account?.id]);

  return (
    <div className="min-h-screen">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-[color:var(--app-cta-bg)] focus:px-4 focus:py-3 focus:text-[color:var(--app-cta-text)]">본문으로 건너뛰기</a>
      <aside data-theme-surface="dark" className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-[color:var(--color-hairline-violet)] bg-[color:var(--color-surface-night)]/95 p-6 backdrop-blur-xl lg:flex">
        <Brand semforge={semforge} />
        <ProjectSwitcher />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation semforgeActive={semforgeActive} guest={guest} />
        </div>
        <div className="mt-4 shrink-0 space-y-3">
          {semforge && <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-xs text-[color:var(--color-on-dark-muted)] hover:text-white"><ArrowLeft className="h-4 w-4" />GEO Master로 돌아가기</Link>}
          <ThemeToggle />
          {account && account.id !== "local" && <form action="/api/auth/logout" method="post" className="text-xs text-[color:var(--color-on-dark-muted)]"><span>{account.id}{guest ? " · 게스트" : ""}</span><button type="submit" className="ml-3 underline">로그아웃</button></form>}
          <div className="rounded-[12px] border border-[color:var(--color-hairline-violet)] bg-[color:var(--color-ink-deep)] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--color-accent-lime)]">
              <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-lime)]" />
              전용 저장소
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[color:var(--color-on-dark-muted)]">데이터와 API 키는 앱이 실행되는 서버의 SQLite에 저장됩니다.</p>
          </div>
        </div>
      </aside>
      <header data-theme-surface="dark" className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[color:var(--color-hairline-violet)] bg-[color:var(--color-surface-night)]/90 px-4 backdrop-blur-xl lg:hidden">
        <Brand semforge={semforge} />
        <div className="flex items-center gap-1">
          <ThemeToggle compact />
          <button type="button" onClick={() => setOpen(true)} className="rounded-[8px] p-2 text-white" aria-label="메뉴 열기" aria-expanded={open} aria-controls="mobile-navigation"><Menu /></button>
        </div>
      </header>
      <Modal open={open} labelledBy={menuTitleId} initialFocus={menuCloseRef} onClose={() => setOpen(false)}><div className="fixed inset-0 z-50 bg-[color:var(--color-primary)]/70 lg:hidden" onClick={() => setOpen(false)}>
        <aside id="mobile-navigation" data-theme-surface="dark" className="flex h-full w-72 max-w-full flex-col border-r border-[color:var(--color-hairline-violet)] bg-[color:var(--color-surface-night)] p-5" onClick={(event) => event.stopPropagation()}>
          <h2 id={menuTitleId} className="sr-only">{semforge ? "SEMForge 메뉴" : "주요 메뉴"}</h2>
          <div className="flex items-center justify-between"><Brand semforge={semforge} close={() => setOpen(false)} /><button ref={menuCloseRef} type="button" onClick={() => setOpen(false)} aria-label="메뉴 닫기" className="p-2 text-[color:var(--color-on-dark-muted)]"><X /></button></div>
          <ProjectSwitcher />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Navigation close={() => setOpen(false)} semforgeActive={semforgeActive} guest={guest} />
          </div>
          <div className="mt-4 shrink-0">
            {semforge && <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-xs text-[color:var(--color-on-dark-muted)] hover:text-white"><ArrowLeft className="h-4 w-4" />GEO Master로 돌아가기</Link>}
            <ThemeToggle />
            {account && account.id !== "local" && <form action="/api/auth/logout" method="post" className="text-xs text-[color:var(--color-on-dark-muted)]"><span>{account.id}{guest ? " · 게스트" : ""}</span><button type="submit" className="ml-3 underline">로그아웃</button></form>}
          </div>
        </aside>
      </div></Modal>
      <main id="main-content" tabIndex={-1} className="outline-none lg:pl-72"><div className="w-full max-w-[2400px] px-4 py-6 sm:px-8 lg:px-10 xl:px-12 2xl:px-16 lg:py-8 xl:py-10">{children}</div></main>
    </div>
  );
}
