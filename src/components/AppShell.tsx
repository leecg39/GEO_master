"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart3, BookOpen, Bot, CalendarClock, ChevronDown, CreditCard, FileCode2, FileDown, FilePenLine, Gauge, Images, LoaderCircle, Menu, PackageOpen, SearchCheck, Settings, Sparkles, Target, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isSemforgePath, SEMFORGE_HUB_PATH, semforgeFeatures } from "@/lib/semforge/navigation";
import { cn } from "@/lib/utils";

const coreNavigation = [
  { href: "/", label: "대시보드", icon: Gauge },
  { href: "/audit", label: "GEO 진단", icon: SearchCheck },
  { href: "/multimodal", label: "멀티모달 감사", icon: Images },
  { href: "/llms", label: "llms.txt", icon: FileCode2 },
  { href: "/share", label: "응답 점유율", icon: BarChart3 },
  { href: "/automation", label: "예약 측정", icon: CalendarClock },
  { href: "/reports", label: "리포트", icon: FileDown },
  { href: "/studio", label: "콘텐츠 스튜디오", icon: FilePenLine },
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
  nested,
}: {
  href: string;
  label: string;
  icon: typeof Gauge;
  active: boolean;
  close?: () => void;
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={close}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 font-medium transition",
        nested ? "py-2 text-xs" : "py-2.5 text-sm",
        active
          ? "bg-[color:var(--color-accent-lime)]/12 text-[color:var(--color-accent-lime)]"
          : "text-[color:var(--color-on-dark-muted)] hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon className={cn(nested ? "h-4 w-4" : "h-4.5 w-4.5", active ? "text-[color:var(--color-accent-lime)]" : "text-[color:var(--color-accent-violet-mid)] group-hover:text-white")} />
      {label}
    </Link>
  );
}

function SemforgeNavDropdown({ close }: { close?: () => void }) {
  const pathname = usePathname();
  const semforgeCurrent = isSemforgePath(pathname);
  const pathKey = semforgeCurrent ? "semforge" : "other";
  const [pathBucket, setPathBucket] = useState(pathKey);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);

  if (pathBucket !== pathKey) {
    setPathBucket(pathKey);
    setOpenOverride(null);
  }

  const open = openOverride ?? semforgeCurrent;

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setOpenOverride(!open)}
        aria-expanded={open}
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
          semforgeCurrent
            ? "bg-[color:var(--color-accent-violet)]/18 text-[color:var(--color-accent-violet)]"
            : "text-[color:var(--color-on-dark-muted)] hover:bg-white/5 hover:text-white",
        )}
      >
        <Sparkles className={cn("h-4.5 w-4.5", semforgeCurrent ? "text-[color:var(--color-accent-violet)]" : "text-[color:var(--color-accent-violet-mid)] group-hover:text-white")} />
        <span className="flex-1 text-left">SEMForge</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[color:var(--color-accent-violet-mid)] transition group-hover:text-white", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-3 mt-1 space-y-0.5 border-l border-[color:var(--color-hairline-violet)] pl-2">
          <NavLink
            href={SEMFORGE_HUB_PATH}
            label="워크스페이스"
            icon={Sparkles}
            active={pathname === SEMFORGE_HUB_PATH}
            close={close}
            nested
          />
          {semforgeFeatures.map(({ href, label, icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return <NavLink key={href} href={href} label={label} icon={icon} active={active} close={close} nested />;
          })}
        </div>
      )}
    </div>
  );
}

function Navigation({ close, semforgeActive }: { close?: () => void; semforgeActive: boolean | null }) {
  const pathname = usePathname();

  return (
    <nav className="mt-8 space-y-1.5" aria-label="주요 메뉴">
      {coreNavigation.map(({ href, label, icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return <NavLink key={href} href={href} label={label} icon={icon} active={active} close={close} />;
      })}

      {semforgeActive === null ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-500">
          <LoaderCircle className="h-4.5 w-4.5 animate-spin" />
          SEMForge 확인 중
        </div>
      ) : semforgeActive ? (
        <SemforgeNavDropdown close={close} />
      ) : (
        <div className="pt-2">
          <NavLink
            href={subscriptionNavigation.href}
            label={subscriptionNavigation.label}
            icon={subscriptionNavigation.icon}
            active={pathname.startsWith(subscriptionNavigation.href)}
            close={close}
          />
        </div>
      )}

      <div className="pt-2">
        <NavLink
          href="/settings"
          label="설정"
          icon={Settings}
          active={pathname.startsWith("/settings")}
          close={close}
        />
      </div>
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[color:var(--color-accent-lime)] text-[color:var(--color-ink-deep)]">
        <Bot className="h-5 w-5" />
      </span>
      <span>
        <strong className="font-display block text-base font-semibold tracking-tight text-white">GEO Master</strong>
        <small className="text-[10px] font-semibold uppercase tracking-[0.25px] text-[color:var(--color-on-dark-muted)]">Answer workspace</small>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [semforgeActive, setSemforgeActive] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/semforge/subscription");
        if (!response.ok) return;
        const data = await response.json() as { subscription?: { active?: boolean } };
        setSemforgeActive(Boolean(data.subscription?.active));
      } catch {
        setSemforgeActive(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-[color:var(--color-hairline-violet)] bg-[color:var(--color-surface-night)]/95 p-6 backdrop-blur-xl lg:flex">
        <Brand />
        <ProjectSwitcher />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Navigation semforgeActive={semforgeActive} />
        </div>
        <div className="mt-4 shrink-0 space-y-3">
          <ThemeToggle />
          <div className="rounded-[12px] border border-[color:var(--color-hairline-violet)] bg-[color:var(--color-ink-deep)] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--color-accent-lime)]">
              <span className="h-2 w-2 rounded-full bg-[color:var(--color-accent-lime)]" />
              로컬 퍼스트
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[color:var(--color-on-dark-muted)]">데이터와 API 키는 이 기기의 SQLite에만 저장됩니다.</p>
          </div>
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[color:var(--color-hairline-violet)] bg-[color:var(--color-surface-night)]/90 px-4 backdrop-blur-xl lg:hidden">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeToggle compact />
          <button type="button" onClick={() => setOpen(true)} className="rounded-[8px] p-2 text-white" aria-label="메뉴 열기"><Menu /></button>
        </div>
      </header>
      {open && <div className="fixed inset-0 z-50 bg-[color:var(--color-primary)]/70 lg:hidden" onClick={() => setOpen(false)}>
        <aside className="flex h-full w-72 flex-col border-r border-[color:var(--color-hairline-violet)] bg-[color:var(--color-surface-night)] p-5" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between"><Brand /><button type="button" onClick={() => setOpen(false)} aria-label="메뉴 닫기" className="p-2 text-[color:var(--color-on-dark-muted)]"><X /></button></div>
          <ProjectSwitcher />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Navigation close={() => setOpen(false)} semforgeActive={semforgeActive} />
          </div>
          <div className="mt-4 shrink-0">
            <ThemeToggle />
          </div>
        </aside>
      </div>}
      <main className="lg:pl-72"><div className="w-full max-w-[2400px] px-4 py-6 sm:px-8 lg:px-10 xl:px-12 2xl:px-16 lg:py-8 xl:py-10">{children}</div></main>
    </div>
  );
}
