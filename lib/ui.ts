import type { TaskStatus } from "@/lib/db/schema";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_proposal: "Awaiting proposal approval",
  building: "Building & testing",
  awaiting_report: "Awaiting change approval",
  committing: "Committing",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function statusColor(status: string): string {
  switch (status) {
    case "done":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    case "failed":
      return "bg-red-500/15 text-red-300 border-red-500/30";
    case "cancelled":
      return "bg-neutral-500/15 text-neutral-300 border-neutral-500/30";
    case "running":
    case "building":
    case "committing":
    case "awaiting_proposal":
    case "awaiting_report":
      return "bg-amber-500/15 text-amber-300 border-amber-500/30";
    default:
      return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  }
}

export const ACTIVE_STATUSES = new Set([
  "queued",
  "running",
  "awaiting_proposal",
  "building",
  "awaiting_report",
  "committing",
]);

export function timeAgo(ts: number | Date | null | undefined): string {
  if (!ts) return "";
  const d = ts instanceof Date ? ts.getTime() : ts;
  const secs = Math.floor((Date.now() - d) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/**
 * Whether a change/audit report surfaces actionable findings or recommendations
 * worth spinning up a fix task. Completion reports ("Committed… complete") and
 * all-clear audits ("Nothing blocking") return false, so the "Create fix task"
 * CTA only shows when there's something to fix.
 */
export function reportHasFindings(report: string): boolean {
  const t = report.toLowerCase();

  // Sections/labels that enumerate problems or recommended changes.
  const hasFindingSection =
    /(^|\n)\s*(#{1,6}\s*|\*\*\s*)?(findings?|issues?|bugs?|blocking|recommendations?|follow[- ]?ups?|action (needed|required|items?)|remaining work|out of scope|known gaps?)\b/m.test(
      t,
    );

  // Severity callouts — emoji, "[high]", or "Critical:"-style line labels.
  const hasSeverity =
    /[🔴🟠🟡]/.test(report) ||
    /\[\s*(critical|high|medium|low)\s*\]/.test(t) ||
    /(^|\n)\s*(critical|high|medium|low)\s*[:\-—]/m.test(t);

  // Recommendation / unresolved-work phrasing.
  const hasRecommendation =
    /\b(recommend|suggest|you (should|could|may want to)|should (fix|address|consider|update|remove)|must (fix|address)|needs? to be (fixed|addressed)|left (unfixed|unresolved)|did not (fix|address)|consider (fixing|adding|removing))\b/.test(
      t,
    );

  const hasUncheckedTodo = /(^|\n)\s*[-*]\s*\[ \]/m.test(report);

  if (!(hasFindingSection || hasSeverity || hasRecommendation || hasUncheckedTodo))
    return false;

  // An explicit all-clear verdict suppresses incidental matches — unless real
  // severity-tagged findings are present (those win).
  const allClear =
    /\b(no (real |outstanding |open |remaining |unresolved |blocking )?(issues?|bugs?|findings?|vulnerabilit\w+|problems?|secrets?|concerns?|regressions?)|nothing (to fix|blocking|actionable|of note|to address)|no action (needed|required)|0 (critical|high|blocking)|all clear|looks good|lgtm)\b/.test(
      t,
    );
  if (allClear && !hasSeverity) return false;

  return true;
}

const ms = (ts: number | Date) => (ts instanceof Date ? ts.getTime() : ts);

/** How long a run took (or has been running), e.g. "1h 23m", "5m 12s", "45s". */
export function formatDuration(
  start: number | Date | null | undefined,
  end: number | Date | null | undefined,
): string {
  if (!start || !end) return "";
  const secs = Math.max(0, Math.floor((ms(end) - ms(start)) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
