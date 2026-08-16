"use client";

import Link from "next/link";
import type { InputHTMLAttributes, ReactNode } from "react";

export function PageShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main
      className={`mx-auto w-full px-4 py-8 sm:px-6 ${wide ? "max-w-5xl" : "max-w-md"}`}
    >
      {children}
    </main>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-gold"
    >
      ← {label}
    </Link>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-panel/80 p-4 sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold tracking-[0.2em] text-gold/90">{children}</h2>
      {extra}
    </div>
  );
}

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs tracking-widest text-muted">{label}</span>
      <input
        {...props}
        className={`w-full rounded-lg border border-line bg-lacquer px-3.5 py-3 text-base text-paper outline-none transition-colors placeholder:text-muted/45 focus:border-gold/70 ${props.className ?? ""}`}
      />
      {hint ? <span className="mt-1.5 block text-xs text-muted/70">{hint}</span> : null}
    </label>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger" | "jade";
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: "bg-gold text-ink hover:bg-gold-soft",
    jade: "bg-jade text-ink hover:bg-jade-soft",
    danger: "bg-vermilion text-paper hover:bg-vermilion-soft",
    ghost: "border border-line bg-panel-2 text-paper hover:border-gold/60 hover:text-gold-soft",
  };
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-4 py-3 text-sm" };

  return (
    <button
      {...props}
      className={`rounded-lg font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Notice({
  kind = "error",
  children,
}: {
  kind?: "error" | "info" | "success";
  children: ReactNode;
}) {
  const styles = {
    error: "border-vermilion/50 bg-vermilion/10 text-vermilion-soft",
    info: "border-line bg-panel-2 text-muted",
    success: "border-jade/50 bg-jade/10 text-jade-soft",
  };
  return (
    <p className={`fade-up rounded-lg border px-3.5 py-3 text-sm ${styles[kind]}`}>
      {children}
    </p>
  );
}

/** 場次代碼的醒目顯示，主持人開場後要唸給玩家聽 */
export function CodeStamp({ code }: { code: string }) {
  return (
    <span className="tabular rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1 text-sm font-bold tracking-widest text-gold-soft">
      {code}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open: { label: "進行中", cls: "border-jade/50 bg-jade/10 text-jade-soft" },
    paused: { label: "暫停中", cls: "border-gold/50 bg-gold/10 text-gold-soft" },
    closed: { label: "已結束", cls: "border-line bg-panel-2 text-muted" },
  };
  const s = map[status] ?? map.closed;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${s.cls}`}>{s.label}</span>
  );
}
