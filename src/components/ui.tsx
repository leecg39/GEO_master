import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-cyan-400">{eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-white/8 bg-slate-900/65 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur", className)} {...props}>{children}</div>;
}

export function Badge({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "cyan"; className?: string }) {
  const tones = {
    default: "border-slate-700 bg-slate-800 text-slate-300",
    good: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    warn: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    bad: "border-rose-400/25 bg-rose-400/10 text-rose-300",
    cyan: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
  };
  return <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const variants = {
    primary: "bg-cyan-400 text-slate-950 hover:bg-cyan-300 disabled:bg-cyan-900 disabled:text-slate-500",
    secondary: "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 disabled:text-slate-600",
    danger: "border border-rose-400/20 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20",
  };
  return <button className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-cyan-400/50 disabled:cursor-not-allowed", variants[variant], className)} {...props} />;
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(100, value)))} className={cn("h-2 overflow-hidden rounded-full bg-slate-800", className)}><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-white/10 px-6 text-center text-sm text-slate-500">{children}</div>;
}
