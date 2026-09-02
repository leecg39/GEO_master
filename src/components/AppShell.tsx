"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart3, BookOpen, Bot, CalendarClock, CreditCard, FileCode2, FileDown, FilePenLine, Gauge, Images, LoaderCircle, Menu, PackageOpen, SearchCheck, Settings, Sparkles, Target, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { isSemforgePath, SEMFORGE_HUB_PATH } from "@/lib/semforge/navigation";
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

const semforgeNavigation = { href: SEMFORGE_HUB_PATH, label: "SEMForge", icon: Sparkles };
const subscriptionNavigation = { href: "/subscription", label: "SEMForge Pro", icon: CreditCard };

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  close,
}: {
  href: string;
  label: string;
  icon: typeof Gauge;
  active: boolean;
  close?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={close}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
        active ? "bg-cyan-400/12 text-cyan-300" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
      )}
    >
      <Icon className={cn("h-4.5 w-4.5", active ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300")} />
      {label}
    </Link>
  );
}

function Navigation({ close, semforgeActive }: { close?: () => void; semforgeActive: boolean | null }) {
  const pathname = usePathname();
  const semforgeCurrent = isSemforgePath(pathname);

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
        <div className="pt-4">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-400">SEMForge Pro</p>
          <NavLink
            href={semforgeNavigation.href}
            label={semforgeNavigation.label}
            icon={semforgeNavigation.icon}
            active={semforgeCurrent}
            close={close}
          />
        </div>
      ) : (
        <div className="pt-4">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-400">Pro 업그레이드</p>
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
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-violet-500 text-slate-950 shadow-lg shadow-cyan-500/10"><Bot className="h-5 w-5" /></span>
      <span><strong className="block text-base tracking-tight text-white">GEO Master</strong><small className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Answer workspace</small></span>
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
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-white/7 bg-slate-950/85 p-6 backdrop-blur-xl lg:block">
        <Brand />
        <ProjectSwitcher />
        <Navigation semforgeActive={semforgeActive} />
        <div className="absolute inset-x-6 bottom-6 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />로컬 퍼스트</div>
          <p className="mt-1.5 text-xs leading-5 text-slate-400">데이터와 API 키는 이 기기의 SQLite에만 저장됩니다.</p>
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/7 bg-slate-950/80 px-4 backdrop-blur-xl lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-300" aria-label="메뉴 열기"><Menu /></button>
      </header>
      {open && <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
        <aside className="h-full w-72 border-r border-white/10 bg-slate-950 p-5" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between"><Brand /><button type="button" onClick={() => setOpen(false)} aria-label="메뉴 닫기" className="p-2 text-slate-400"><X /></button></div>
          <ProjectSwitcher />
          <Navigation close={() => setOpen(false)} semforgeActive={semforgeActive} />
        </aside>
      </div>}
      <main className="lg:pl-72"><div className="w-full max-w-[2400px] px-4 py-6 sm:px-8 lg:px-10 xl:px-12 2xl:px-16 lg:py-8 xl:py-10">{children}</div></main>
    </div>
  );
}
