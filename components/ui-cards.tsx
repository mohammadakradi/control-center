import type { ReactNode } from "react";

/** Shared card surface used across detail pages. */
export const card =
  "rounded-2xl border border-neutral-800 bg-gradient-to-b from-white/[0.015] to-transparent bg-neutral-900/40 p-6";

/** A `card` with a standard header row (title + optional right-aligned slot).
 *  `min-w-0` lets it shrink inside grid/flex parents so long content truncates
 *  instead of forcing horizontal page scroll. */
export function CardSection({
  title,
  right,
  className = "",
  children,
}: {
  title: string;
  /** Optional right-aligned header content (icon, count, caption). */
  right?: ReactNode;
  /** Extra classes — e.g. `lg:col-span-2` for full-width sections. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`${card} min-w-0 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Chip({
  children,
  icon,
  tone = "neutral",
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "ok" | "violet" | "sky";
}) {
  const tones = {
    neutral: "border-neutral-700 bg-neutral-800/60 text-neutral-300",
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${tones[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

export function Tile({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "ok";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-900/60 px-4 py-3.5">
      <span
        className={`text-2xl font-bold tracking-tight ${tone === "ok" ? "text-emerald-400" : ""}`}
      >
        {value}
      </span>
      <span className="text-xs text-neutral-500">{label}</span>
    </div>
  );
}

export function Fact({
  children,
  icon,
  tag,
  tagTone = "neutral",
}: {
  children: ReactNode;
  icon: ReactNode;
  tag?: string;
  tagTone?: "neutral" | "ok" | "warn";
}) {
  const tones = {
    neutral: "border-neutral-700 bg-neutral-800/60 text-neutral-400",
    ok: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  };
  return (
    <li className="flex items-center gap-3 border-t border-neutral-800 py-2.5 text-sm text-neutral-400 first:border-t-0">
      <span className="text-neutral-600">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {tag && (
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px] ${tones[tagTone]}`}
        >
          {tag}
        </span>
      )}
    </li>
  );
}
