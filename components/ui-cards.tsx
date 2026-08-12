import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Shared card surface used across detail pages. */
export const card = "rounded-2xl border border-line bg-surface p-6";

/** Standard page title block. Every top-level page uses this so the heading
 *  size and description treatment stay consistent. Carries no outer margin —
 *  pages place it inside their own `space-y-*` container. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** Right-aligned actions (buttons, links). */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-fg-strong">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-fg-subtle">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Placeholder for an empty list or section. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <span className="text-fg-ghost">{icon}</span>}
      <p className="text-sm font-medium text-fg-muted">{title}</p>
      {hint && <p className="max-w-sm text-xs text-fg-faint">{hint}</p>}
      {action}
    </div>
  );
}

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
        <h2 className="text-base font-semibold text-fg-strong">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** The "there is more of this elsewhere" link for a `CardSection` header — a truncated or
 *  capped list points at the page that holds the whole thing. Lives here rather than in a
 *  page because the dashboard and the Tasks page both head sections with it. */
export function ViewAll({
  href,
  children = "View all",
}: {
  href: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
    >
      {children} <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

export function Chip({
  children,
  icon,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "ok" | "violet" | "sky" | "warn";
  /** Native tooltip — for a chip whose one word needs a sentence behind it. */
  title?: string;
}) {
  const tones = {
    neutral: "border-muted-line bg-muted-soft text-muted",
    ok: "border-ok-line bg-ok-soft text-ok",
    violet: "border-violet-line bg-violet-soft text-violet",
    sky: "border-info-line bg-info-soft text-info",
    // Caution rather than failure — used for the "agent-filed" backlog marker, where the
    // point is that nobody has reviewed the text yet.
    warn: "border-warn-line bg-warn-soft text-warn",
  };
  return (
    <span
      title={title}
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
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface-2 px-4 py-3.5">
      <span
        className={`text-2xl font-bold tracking-tight ${tone === "ok" ? "text-ok" : "text-fg-strong"}`}
      >
        {value}
      </span>
      <span className="text-xs text-fg-faint">{label}</span>
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
    neutral: "border-muted-line bg-muted-soft text-fg-subtle",
    ok: "border-ok-line bg-ok-soft text-ok",
    warn: "border-warn-line bg-warn-soft text-warn",
  };
  return (
    <li className="flex items-center gap-3 border-t border-line py-2.5 text-sm text-fg-subtle first:border-t-0">
      <span className="text-fg-ghost">{icon}</span>
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
