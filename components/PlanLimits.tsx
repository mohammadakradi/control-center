"use client";

import { useEffect, useState } from "react";
import { CardSection, Chip } from "@/components/ui-cards";
import { formatResetsIn, windowLabel } from "@/lib/usage-format";

/**
 * Claude *plan* rate-limit windows, when they can be read at all.
 *
 * On this app they usually can't: tokens are injected per user through `Options.env`, and
 * the SDK only reports plan limits for a logged-in profile (see `runner/usage-snapshot.ts`).
 * That is the normal state, not an error — so this renders **nothing**: no card, no
 * skeleton, no "unavailable" message. It will simply appear if a future SDK scopes env
 * tokens for it.
 *
 * Client component so the runner probe (~1.7s on a cache miss) never blocks the page.
 * The shape is re-checked here rather than trusted: it comes from an SDK API that is
 * explicitly experimental.
 */

type Window = { key: string; utilization: number | null; resetsAt: string | null };

export function PlanLimits() {
  const [limits, setLimits] = useState<{
    subscriptionType: string | null;
    windows: Window[];
    fetchedAt: number;
  } | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/usage", { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        const parsed = parseLimits(body);
        if (parsed) setLimits(parsed);
      })
      // Aborts, offline, 401 after a session expiry — all mean "no limits to show".
      .catch(() => {});
    return () => abort.abort();
  }, []);

  if (!limits) return null;

  return (
    <CardSection
      title="Claude plan limits"
      right={
        limits.subscriptionType ? (
          <Chip tone="violet">{limits.subscriptionType}</Chip>
        ) : undefined
      }
    >
      <ul className="space-y-4">
        {limits.windows.map((w) => (
          <li key={w.key}>
            <WindowBar window={w} now={limits.fetchedAt} />
          </li>
        ))}
      </ul>
    </CardSection>
  );
}

function WindowBar({ window: w, now }: { window: Window; now: number }) {
  const label = windowLabel(w.key);
  const resetsIn = formatResetsIn(w.resetsAt, now);
  const pct = w.utilization;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm text-fg">{label}</span>
        <span className="flex items-baseline gap-2 text-xs">
          {resetsIn && (
            <span className="text-fg-faint">Resets in {resetsIn}</span>
          )}
          {/* A window the SDK reported without a utilization: say so, rather than a bare
              dash that reads as nothing at all to a screen reader. */}
          {pct === null ? (
            <span className="text-fg-faint">Utilization unknown</span>
          ) : (
            <span className="font-mono text-fg-strong">{`${Math.round(pct)}%`}</span>
          )}
        </span>
      </div>
      {pct !== null && (
        <div
          role="progressbar"
          aria-label={`${label} used`}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3"
        >
          {/* Tone is redundant with the percentage printed above — never the only signal. */}
          <div
            className={`h-full rounded-full ${pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-ok"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </>
  );
}

/** Narrow the `/api/usage` body to renderable limits, or null. */
function parseLimits(body: unknown) {
  if (typeof body !== "object" || body === null) return null;
  const rate = (body as { rateLimits?: unknown }).rateLimits;
  if (typeof rate !== "object" || rate === null) return null;
  const r = rate as Record<string, unknown>;
  if (r.available !== true || !Array.isArray(r.windows)) return null;

  // Re-derive every field, don't just cast. A non-numeric `utilization` would reach
  // `width: NaN%`, which a browser drops — leaving a full-width bar that reads as "100%
  // used". Silently wrong beats visibly broken only if it's actually right, so clamp here
  // the same way `runner/usage-snapshot.ts` does on the way out.
  const windows: Window[] = r.windows.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const w = raw as Record<string, unknown>;
    if (typeof w.key !== "string") return [];
    return [
      {
        key: w.key,
        utilization:
          typeof w.utilization === "number" && Number.isFinite(w.utilization)
            ? Math.max(0, Math.min(100, w.utilization))
            : null,
        resetsAt: typeof w.resetsAt === "string" ? w.resetsAt : null,
      },
    ];
  });
  if (windows.length === 0) return null;

  // The snapshot's own timestamp, not the browser clock: it's the instant the utilizations
  // were measured, so the countdown can't be skewed by a client whose clock is off.
  const fetchedAt =
    typeof r.fetchedAt === "string" ? Date.parse(r.fetchedAt) : Number.NaN;

  return {
    subscriptionType:
      typeof r.subscriptionType === "string" ? r.subscriptionType : null,
    windows,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(),
  };
}
