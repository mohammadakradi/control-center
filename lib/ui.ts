import type { BacklogStatus, TaskStatus } from "@/lib/db/schema";

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

/** Semantic tone classes for a task status. Theme-aware via the tone tokens in
 *  `app/globals.css` — do not reintroduce raw palette shades here. */
export function statusColor(status: string): string {
  switch (status) {
    case "done":
      return "bg-ok-soft text-ok border-ok-line";
    case "failed":
      return "bg-danger-soft text-danger border-danger-line";
    case "cancelled":
      return "bg-muted-soft text-muted border-muted-line";
    case "running":
    case "building":
    case "committing":
    case "awaiting_proposal":
    case "awaiting_report":
      return "bg-warn-soft text-warn border-warn-line";
    default:
      return "bg-info-soft text-info border-info-line";
  }
}

/** A backlog item's status, in words. Sentence case like `STATUS_LABEL`, so the two
 *  vocabularies read the same when they sit in one row (an item and the task it ran as). */
export const BACKLOG_STATUS_LABEL: Record<BacklogStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

/**
 * Which statuses close an item out.
 *
 * The single definition of "open": the backlog page groups by it, and `lib/backlog.ts`
 * counts against `MAX_ITEMS_PER_PROJECT` by it — and those two disagreeing would mean a
 * project whose cap says "full" while the page shows an empty Open section.
 */
export const CLOSED_BACKLOG_STATUSES = ["done", "cancelled"] as const;

export const isOpenBacklogStatus = (status: BacklogStatus): boolean =>
  !CLOSED_BACKLOG_STATUSES.includes(status as (typeof CLOSED_BACKLOG_STATUSES)[number]);

/**
 * The status dot beside a backlog item — a solid tone fill, which the design system allows
 * only for small non-text marks like this one. It is decorative on purpose: the status is
 * also written out in the control next to it, so nothing here is carried by colour alone.
 *
 * Tones match the task statuses they correspond to, so a backlog row and a task row don't
 * mean different things by the same colour: not-started is `info` (like `queued`), running
 * is `warn`, `done` is `ok`, `cancelled` is `muted`.
 */
export function backlogStatusDot(status: BacklogStatus): string {
  switch (status) {
    case "done":
      return "bg-ok";
    case "cancelled":
      return "bg-muted";
    case "in_progress":
      return "bg-warn";
    default:
      return "bg-info";
  }
}

/** Stored model label → display name. "sonnet"/"opus" are legacy labels from
 *  before the per-agent tiering (kept so old tasks render correctly). */
export const MODEL_DISPLAY: Record<string, string> = {
  "sonnet-4.6": "Sonnet 4.6",
  "opus-4.8": "Opus 4.8",
  "opus-5": "Opus 5",
  "sonnet-5": "Sonnet 5",
  "fable-5": "Fable 5",
  sonnet: "Sonnet 4.6",
  opus: "Opus 4.8",
};

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
 * What to call a task in the UI: its generated title, else the raw request it was
 * dispatched with, else nothing.
 *
 * `tasks.title` is a short human-readable name generated at dispatch (`schema.ts`), so it
 * is what makes history scannable by intent; `requestText` is the whole prose request and
 * only a fallback for tasks that predate titling or whose generation failed. Both can be
 * empty. Callers own the last resort — a list row already shows `/namespace:command`
 * beside the name, while the task page falls back *to* that command string.
 *
 * One definition on purpose: this chain was previously inlined at three call sites and two
 * of them had silently dropped the title.
 */
export function taskDisplayTitle(task: {
  title?: string | null;
  requestText?: string | null;
}): string | null {
  return task.title?.trim() || task.requestText?.trim() || null;
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

/**
 * The order an agent's skills are offered in — the order someone works, not the alphabet.
 *
 * Discovery reads a plugin's `commands/` directory and sorts by filename
 * (`lib/discovery/agents.ts`), which puts `audit`/`onboard` in front of `task`. A skill not
 * listed here keeps its alphabetical place after the listed ones, so a new command added to
 * an agent still shows up without a change here.
 */
const SKILL_ORDER: Record<string, string[]> = {
  swe: ["task", "fix", "security", "review", "plan", "ship", "workspace"],
  fe: ["task", "fix", "audit", "review", "plan", "ship"],
  pm: ["plan"],
};

/**
 * Order an agent's skills for the picker, and decide whether `onboard` belongs there at all.
 *
 * Onboarding is a one-time step per project: until it's done it's the obvious first thing, and
 * once it's done it's clutter in front of the skills someone actually came for. So it leads the
 * list while the agent isn't onboarded and is dropped once it is — the caller re-includes it
 * (by passing `onboarded: false`) when offering a deliberate re-onboard.
 */
export function orderSkills<T extends { name: string }>(
  namespace: string | undefined,
  commands: T[],
  onboarded: boolean,
): T[] {
  const order = (namespace && SKILL_ORDER[namespace]) || [];
  const rank = (n: string) => {
    const i = order.indexOf(n);
    return i === -1 ? order.length : i;
  };
  const ordered = [...commands].sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name),
  );
  if (onboarded) return ordered.filter((c) => c.name !== "onboard");
  const onboard = ordered.find((c) => c.name === "onboard");
  return onboard ? [onboard, ...ordered.filter((c) => c.name !== "onboard")] : ordered;
}

/**
 * The link that resolves a refused dispatch, read off the response body.
 *
 * Both dispatch endpoints (`POST /api/tasks` and the backlog's run action) refuse in the same
 * actionable ways, so the mapping lives here rather than being re-derived at each call site:
 * a `taskId` came back with the refusal, or **412** says this account has no Anthropic token.
 * Anything else has no next step and returns null — the message stands alone.
 *
 * The label is **"Open the task"**, not "Open it", because `taskId` arrives from two different
 * refusals and only one of them is a live run: the backlog's **409** hands back the session
 * already going, while `createAndStartTask`'s **502** hands back a row it saved as `failed`
 * when the runner couldn't be reached. "Open it" reads as "the run already going" and would be
 * a small lie in the second case; naming the noun is true in both.
 *
 * `taskId` is checked to be a string before it is interpolated. The prefix is a literal, so no
 * response could smuggle in a `javascript:` href, but a non-string would render `/tasks/[object
 * Object]` — a link that looks real and 404s.
 */
export function dispatchErrorAction(
  body: { taskId?: unknown; needsToken?: unknown } | null | undefined,
): { href: string; label: string } | null {
  if (typeof body?.taskId === "string" && body.taskId !== "") {
    return { href: `/tasks/${body.taskId}`, label: "Open the task" };
  }
  if (body?.needsToken) return { href: "/settings", label: "Open Settings" };
  return null;
}

const ms = (ts: number | Date) => (ts instanceof Date ? ts.getTime() : ts);

/** What `GET /api/tasks/:id/changes` answers. `error` is the 404 body (`lib/task-access` makes
 *  "not yours" and "doesn't exist" identical), so it can arrive instead of the other fields. */
export type TaskChangesResponse = {
  available?: boolean;
  reason?: "not-git" | "workspace";
  scope?: "checkout" | "worktree" | "worktree-removed";
  branch?: string | null;
  changes?: {
    files: { path: string; status: string; added: number; deleted: number }[];
    totalAdded: number;
    totalDeleted: number;
    truncated: number;
  } | null;
  error?: string;
};

export type TaskChangesView =
  /** Render no card at all — nothing to say, so an empty card would be noise. */
  | { kind: "hidden" }
  /** The isolated worktree is gone; `branch` is where the committed work is. */
  | { kind: "removed"; branch: string | null }
  | { kind: "empty"; scope: "checkout" | "worktree" }
  | {
      kind: "list";
      scope: "checkout" | "worktree";
      changes: NonNullable<TaskChangesResponse["changes"]>;
      /** Whether the list is exclusively this run's work — drives the default expansion and
       *  whether the "shared checkout" caveat is shown. */
      exclusive: boolean;
    };

/**
 * Turn a changes response into what the card should render.
 *
 * Extracted from `components/TaskChanges.tsx` because this is the branchiest part of that feature
 * and `pnpm test` cannot reach `components/` — the same reason `orderSkills` lives here. An
 * independent review flagged it as the new code with the least verification; now it has specs.
 *
 * Note `data === null` (still loading) and a truthy `error` both answer `hidden`: a card that may
 * turn out to have nothing to show must not flash first, and a 404 here means the task itself is
 * not visible to this caller, which the page already handles.
 */
export function taskChangesView(
  data: TaskChangesResponse | null,
): TaskChangesView {
  if (!data || data.error || data.available === false) return { kind: "hidden" };
  if (data.scope === "worktree-removed")
    return { kind: "removed", branch: data.branch ?? null };
  const scope = data.scope === "worktree" ? "worktree" : "checkout";
  const changes = data.changes;
  if (!changes || changes.files.length === 0) return { kind: "empty", scope };
  return { kind: "list", scope, changes, exclusive: scope === "worktree" };
}

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
