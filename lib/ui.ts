import type {
  BacklogStatus,
  FeatureStatus,
  TaskMergeState,
  TaskStatus,
} from "@/lib/db/schema";

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

/** The tone tokens a task status maps onto. One of the six documented in
 *  `.fe/design-system.md`; `violet` is not among them (nothing about a run is a workspace). */
export type StatusTone = "ok" | "danger" | "warn" | "info" | "muted";

/**
 * Task status → semantic tone. **The** choke point: every treatment below is a lookup on
 * this, so a status can never be `warn` in one component and `info` in another.
 *
 * Extracted from `statusColor` when a second treatment appeared (`Toaster`, which needs the
 * tone without the soft background — a floating element must sit on an opaque surface).
 */
export function statusTone(status: string): StatusTone {
  switch (status) {
    case "done":
      return "ok";
    case "failed":
      return "danger";
    case "cancelled":
      return "muted";
    case "running":
    case "building":
    case "committing":
    case "awaiting_proposal":
    case "awaiting_report":
      return "warn";
    default:
      return "info";
  }
}

const STATUS_BADGE_CLASSES: Record<StatusTone, string> = {
  ok: "bg-ok-soft text-ok border-ok-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  warn: "bg-warn-soft text-warn border-warn-line",
  info: "bg-info-soft text-info border-info-line",
  muted: "bg-muted-soft text-muted border-muted-line",
};

/** Semantic tone classes for a task status. Theme-aware via the tone tokens in
 *  `app/globals.css` — do not reintroduce raw palette shades here. */
export function statusColor(status: string): string {
  return STATUS_BADGE_CLASSES[statusTone(status)];
}

/**
 * The **border** a status tints when its background can't be toned — i.e. anything
 * *floating* over scrolling page content, which needs an opaque surface token because
 * `--{tone}-soft` is a translucent wash in dark mode (`ActivityBadge`'s pill learned this
 * first; `Toaster` is the second call site).
 *
 * The `border` width ships **inside** each value rather than being added by the caller: two
 * same-specificity border-colour utilities on one element race in the emitted CSS, which is
 * the trap `GettingStarted` documents. One class string per tone, no second border class.
 */
const STATUS_BORDER_CLASSES: Record<StatusTone, string> = {
  ok: "border border-ok-line",
  danger: "border border-danger-line",
  warn: "border border-warn-line",
  info: "border border-info-line",
  muted: "border border-muted-line",
};

export function statusBorderColor(status: string): string {
  return STATUS_BORDER_CLASSES[statusTone(status)];
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

/**
 * Where a feature-linked task's branch stands relative to its feature branch, in words.
 *
 * Sentence case like the other two label maps, so a merge chip and a `StatusBadge` sitting in
 * one row read as the same vocabulary. The three names are exactly the ones the runner records
 * (`TaskMergeState`) — a second spelling here would be a vocabulary that could drift from the
 * state it describes.
 */
export const MERGE_STATE_LABEL: Record<TaskMergeState, string> = {
  pending: "Not merged",
  merged: "Merged",
  conflict: "Merge conflict",
};

/**
 * The tone a merge state renders in.
 *
 * `conflict` is **`warn`, not `danger`**, and the distinction is the point: the merge failing
 * is not the *run* failing. A task can be `done` with `mergeState: "conflict"` — the agent's
 * work finished and its branch is intact; what's left is a human resolving the merge. `warn` is
 * this app's "caution, you need to do something" tone (it is what the gate statuses use), which
 * is precisely the state. Reserving `danger` for a failed run also means the two can be told
 * apart at a glance in a list that holds both.
 *
 * `pending` is `muted` rather than `info` because for a checkout run it is the *terminal*
 * answer, not a step on the way to one (see below) — a tone implying "in flight" would be a
 * promise nothing is going to keep.
 */
export function mergeStateTone(state: TaskMergeState): "ok" | "warn" | "muted" {
  switch (state) {
    case "merged":
      return "ok";
    case "conflict":
      return "warn";
    default:
      return "muted";
  }
}

/**
 * A feature heading's merge summary: how many of the group's rows merged, and how many hit a
 * conflict.
 *
 * **`pending` is deliberately not counted**, and this is the one decision in here worth not
 * relitigating. A *non-isolated* (checkout) feature run stays `pending` forever by design — the
 * platform never system-merges one, so `pending` there is the honest answer rather than a stuck
 * state (see the runner notes in CLAUDE.md). Summarising it would put a "3 pending" chip on the
 * heading of every feature whose work ran in the checkout, which reads as a queue that is never
 * going to drain. The per-row chip still says `Not merged`, so nothing is hidden — what's
 * dropped is only the *aggregate*, which is where the false impression came from.
 *
 * Returns zeroes rather than null so a caller can render both chips conditionally without a
 * null check; `hasMergeSummary` is the "is there anything to show" test.
 */
export function featureMergeSummary(
  states: readonly (TaskMergeState | null | undefined)[],
): { merged: number; conflict: number } {
  let merged = 0;
  let conflict = 0;
  for (const s of states) {
    if (s === "merged") merged += 1;
    else if (s === "conflict") conflict += 1;
  }
  return { merged, conflict };
}

export const hasMergeSummary = (s: { merged: number; conflict: number }): boolean =>
  s.merged > 0 || s.conflict > 0;

/** One feature's worth of rows. `feature` is null for the ungrouped bucket. */
export type FeatureGroup<Row, F> = { feature: F | null; rows: Row[] };

/** What a feature picker needs of a feature. Structurally satisfied by a `Feature` row, so a
 *  page passes `listFeatures()` straight through. */
export type FeatureChoice = {
  id: string;
  name: string;
  branch: string;
  status: FeatureStatus;
};

/**
 * Options for a "which feature is this part of?" `Select` — "No feature" first, then the
 * project's **active** features.
 *
 * Closed features are dropped because this control files *new* work: a feature someone closed
 * out has had its branch merged or abandoned, so adding a run to it would quietly reopen
 * something every list on the site shows as finished. They stay fully visible in the grouped
 * lists, so no history is hidden — this bounds only where new work may be filed.
 *
 * The branch travels as each option's `description`, which is what makes two similarly-named
 * features tellable apart — and it is the string the user will have to type into `git checkout`
 * later, so seeing it at the moment of choosing is the useful place for it.
 *
 * Always returns at least the "No feature" entry, so a caller can decide whether the control is
 * worth showing by asking whether there is more than one option — a project whose only features
 * are closed has nothing to offer and gets a length of 1.
 */
export function featureOptions(
  features: readonly FeatureChoice[],
): { value: string; label: string; description: string }[] {
  return [
    { value: "", label: "No feature", description: "Not part of a grouped feature" },
    ...features
      .filter((f) => f.status === "active")
      .map((f) => ({ value: f.id, label: f.name, description: f.branch })),
  ];
}

/**
 * Group rows by the feature they belong to, or answer **null** when none of them do.
 *
 * That null is the whole contract of this function. Grouping a list where nothing has a feature
 * would wrap every existing list in the app in a single "No feature" heading — a heading that
 * adds a level of hierarchy while conveying nothing, on every install that hasn't used features
 * yet. So the callers render their plain, un-grouped list in that case and the surfaces are
 * byte-identical to before. It is also the answer for an *empty* list, so an empty state stays
 * an empty state rather than becoming an empty group.
 *
 * Order is **insertion order of the rows themselves**, which is what makes this need no sort:
 * every caller hands us a list already ordered the way that page orders work (newest-first for
 * tasks, the backlog's own ordering for items), so the feature whose work is most recent leads
 * — the same rule `/tasks` already uses to order its project cards.
 *
 * The ungrouped bucket goes **last**, and only exists when something is actually in it: the
 * features are what the reader came for, and ungrouped work is the remainder. A row whose
 * `featureId` doesn't resolve (a feature deleted while the page was rendering — `featureId`'s
 * FK is `set null`, so a row can briefly outlive it) falls into that same bucket rather than
 * being dropped: work must never disappear from a list because its grouping did.
 */
export function groupByFeature<Row, F extends { id: string }>(
  rows: readonly Row[],
  /**
   * The row's feature, or null/undefined for ungrouped.
   *
   * Resolving is the caller's job rather than this function's, because the two kinds of row
   * hold it differently and neither should have to fake the other's shape: a backlog item
   * carries the whole feature (`listBacklog` joins it), while a task carries only a
   * `featureId` and its page holds the lookup map. Grouping keys off `feature.id`, so a
   * caller that resolves nothing simply gets the ungrouped answer.
   */
  featureOf: (row: Row) => F | null | undefined,
): FeatureGroup<Row, F>[] | null {
  const grouped = new Map<string, FeatureGroup<Row, F>>();
  const ungrouped: Row[] = [];

  for (const row of rows) {
    const feature = featureOf(row);
    if (!feature) {
      ungrouped.push(row);
      continue;
    }
    const bucket = grouped.get(feature.id);
    if (bucket) bucket.rows.push(row);
    else grouped.set(feature.id, { feature, rows: [row] });
  }

  if (grouped.size === 0) return null;
  const groups = [...grouped.values()];
  if (ungrouped.length > 0) groups.push({ feature: null, rows: ungrouped });
  return groups;
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
