"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BarChart3, BookOpen, Bot, FilePenLine, Gauge, Menu, SearchCheck, Settings, Target, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "대시보드", icon: Gauge },
  { href: "/audit", label: "GEO 진단", icon: SearchCheck },
  { href: "/share", label: "응답 점유율", icon: BarChart3 },
  { href: "/studio", label: "콘텐츠 스튜디오", icon: FilePenLine },
  { href: "/strategy", label: "전략 워크스페이스", icon: Target },
  { href: "/learn", label: "학습 센터", icon: BookOpen },
  { href: "/settings", label: "설정", icon: Settings },
];

function Navigation({ close }: { close?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="mt-8 space-y-1.5" aria-label="주요 메뉴">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link key={href} href={href} onClick={close} className={cn(
            "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
            active ? "bg-cyan-400/12 text-cyan-300" : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
          )}>
            <Icon className={cn("h-4.5 w-4.5", active ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300")} />
            {label}
          </Link>
        );
      })}
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
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-68 border-r border-white/7 bg-slate-950/85 p-5 backdrop-blur-xl lg:block">
        <Brand />
        <Navigation />
        <div className="absolute inset-x-5 bottom-5 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />로컬 퍼스트</div>
          <p className="mt-1.5 text-[11px] leading-4 text-slate-500">데이터와 API 키는 이 기기의 SQLite에만 저장됩니다.</p>
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/7 bg-slate-950/80 px-4 backdrop-blur-xl lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-300" aria-label="메뉴 열기"><Menu /></button>
      </header>
      {open && <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
        <aside className="h-full w-72 border-r border-white/10 bg-slate-950 p-5" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between"><Brand /><button type="button" onClick={() => setOpen(false)} aria-label="메뉴 닫기" className="p-2 text-slate-400"><X /></button></div>
          <Navigation close={() => setOpen(false)} />
        </aside>
      </div>}
      <main className="lg:pl-68"><div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-7 lg:px-10 lg:py-10">{children}</div></main>
    </div>
  );
}
