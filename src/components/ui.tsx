import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 text-[15px] font-medium uppercase tracking-[0.2px] text-[color:var(--color-accent-violet-mid)]">{eyebrow}</p>
        <h1 className="font-display text-[30px] font-medium leading-[1.2] tracking-tight text-white sm:text-[36px]">{title}</h1>
        <p className="mt-3 max-w-3xl text-base font-normal leading-[2] text-[color:var(--color-on-dark-muted)]">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-[color:var(--app-card-border)] bg-[color:var(--app-card-bg)] p-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "cyan"; className?: string }) {
  const tones = {
    default: "border-[color:var(--color-hairline-violet)] bg-[color:var(--color-surface-night)] text-white",
    good: "border-[color:var(--color-accent-lime)]/30 bg-[color:var(--color-accent-lime)]/15 text-[color:var(--color-accent-lime)]",
    warn: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    bad: "border-[color:var(--color-accent-pink)]/30 bg-[color:var(--color-accent-pink)]/10 text-[color:var(--color-accent-pink)]",
    cyan: "border-[color:var(--color-accent-violet)]/30 bg-[color:var(--color-accent-violet)]/15 text-[color:var(--color-accent-violet)]",
  };
  return (
    <span className={cn("inline-flex rounded-[4px] border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.25px]", tones[tone], className)}>
      {children}
    </span>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }>(function Button({ className, variant = "primary", ...props }, ref) {
  const variants = {
    primary:
      "bg-[color:var(--app-cta-bg)] text-[color:var(--app-cta-text)] shadow-[rgba(0,0,0,0.08)_0_2px_8px_0] hover:opacity-95 active:bg-[color:var(--app-cta-pressed-bg)] active:text-[color:var(--app-cta-pressed-text)] disabled:bg-[color:var(--color-hairline-cloud)] disabled:text-[color:var(--color-on-dark-muted)] disabled:shadow-none",
    secondary:
      "border border-[color:var(--color-hairline-violet)] bg-[color:var(--color-on-dark-faint)] text-white hover:bg-[color:var(--color-accent-violet-mid)]/40 disabled:text-[color:var(--color-on-dark-muted)]",
    danger:
      "border border-[color:var(--color-accent-pink)]/25 bg-[color:var(--color-accent-pink)]/10 text-[color:var(--color-accent-pink)] hover:bg-[color:var(--color-accent-pink)]/20",
  };
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[14px] font-bold uppercase tracking-[0.2px] transition focus:outline-none focus:ring-2 focus:ring-[color:var(--color-ring-focus)] disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});

export function Progress({ value, className, ariaLabel = "진행률" }: { value: number; className?: string; ariaLabel?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.max(0, Math.min(100, value)))}
      className={cn("h-2 overflow-hidden rounded-full bg-[color:var(--color-hairline-violet)]", className)}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-[color:var(--color-accent-violet)] to-[color:var(--color-accent-pink)] transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-36 items-center justify-center rounded-[12px] border border-dashed border-[color:var(--color-hairline-violet)] px-6 text-center text-sm text-[color:var(--color-on-dark-muted)]">
      {children}
    </div>
  );
}
