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
 * one row read as the same vocabulary. The names are exactly the ones the runner records
 * (`TaskMergeState`) — a second spelling here would be a vocabulary that could drift from the
 * state it describes. Note `pending`'s label describes the *run*, not a verdict: the old
 * "Not merged" read as one, when for a checkout run the honest reading is "the agent commits
 * directly, there is nothing separate to merge" — its work is typically already in the
 * feature branch. That misreading happened to a real user (2026-08-22). Rows render through
 * `mergeChipView`, which picks the right pending phrasing per run; this map is the shared
 * vocabulary it draws from.
 */
export const MERGE_STATE_LABEL: Record<TaskMergeState, string> = {
  pending: "In checkout",
  merged: "Merged",
  conflict: "Merge conflict",
  blocked: "Merge waiting",
  no_commits: "Nothing to merge",
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
 * `blocked` is `muted`, not `warn`: nothing needs doing — the platform retries it by itself
 * whenever the project frees up, and a caution tone would summon the user to a job that isn't
 * theirs. `pending` and `no_commits` are `muted` because they are honest terminal answers,
 * not steps on the way to one — a tone implying "in flight" would be a promise nothing is
 * going to keep.
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

/** Tooltip prose per state — beside the labels so the whole vocabulary has one testable home
 *  (it used to live in the component, where `pnpm test` can't reach); the branchy pending
 *  phrasings live in `mergeChipView` below. */
export const MERGE_STATE_TITLE: Record<TaskMergeState, string> = {
  merged: "This task's branch was merged into the feature branch when the run finished.",
  conflict:
    "Merging this task's branch into the feature branch hit a real content conflict. Both " +
    "branches are intact — resolve and merge by hand; the chip updates once the branch is in.",
  blocked:
    "The merge couldn't run yet (the feature branch's checkout was in use). The platform " +
    "retries it automatically when the project frees up — nothing to do.",
  no_commits:
    "This run's branch has no commits of its own — either nothing was committed, or its work " +
    "already reached the feature branch. A kept worktree still holds any uncommitted work.",
  pending:
    "This run works directly in the project checkout, where the agent commits itself — " +
    "normally on the feature branch — so there is nothing separate for the platform to merge.",
};

/** What a merge chip needs of a task row. `parallel` is optional because some projections (a
 *  backlog item's linked task) don't carry it — the view degrades to the generic phrasing. */
export type MergeChipInput = {
  mergeState: TaskMergeState | null | undefined;
  status: TaskStatus | string;
  parallel?: boolean | null;
};

export type MergeChipView = {
  state: TaskMergeState;
  label: string;
  tone: "ok" | "warn" | "muted";
  title: string;
};

/**
 * What a task row's merge chip should say — or null for no chip at all.
 *
 * The recorded outcomes (`merged` / `conflict` / `blocked` / `no_commits`) speak for
 * themselves. `pending` doesn't: it means three different things depending on where the run
 * stands, and rendering one word for all three is exactly what confused a real user
 * (2026-08-22 — "other tasks show not merged which I don't know what they mean"):
 *
 * - a **cancelled or failed** run gets **no chip** — no merge was ever attempted, and a merge
 *   verdict on a run that didn't finish is noise implying the merge itself went wrong;
 * - a **live run that may isolate** (`parallel` not explicitly false) reads "Merges when
 *   done" — the one pending that really is a step on the way somewhere, so it may promise;
 * - everything else reads "In checkout": the run shares the project checkout, the agent
 *   commits there directly (normally on the feature branch itself), so the platform never has
 *   anything separate to merge — the work is typically *in* the branch despite no platform
 *   merge having happened, which is why the old "Not merged" label was worse than silence.
 */
export function mergeChipView(t: MergeChipInput): MergeChipView | null {
  if (!t.mergeState) return null;
  if (t.mergeState !== "pending") {
    return {
      state: t.mergeState,
      label: MERGE_STATE_LABEL[t.mergeState],
      tone: mergeStateTone(t.mergeState),
      title: MERGE_STATE_TITLE[t.mergeState],
    };
  }
  if (t.status === "cancelled" || t.status === "failed") return null;
  const terminal = t.status === "done";
  if (!terminal && t.parallel !== false) {
    return {
      state: "pending",
      label: "Merges when done",
      tone: "muted",
      title:
        "This run is isolated on its own branch — the platform merges it into the feature " +
        "branch automatically when the run finishes.",
    };
  }
  return {
    state: "pending",
    label: MERGE_STATE_LABEL.pending,
    tone: "muted",
    title: MERGE_STATE_TITLE.pending,
  };
}

/**
 * A feature heading's merge summary: how many of the group's rows merged, hit a conflict, or
 * are waiting for a blocked merge to retry.
 *
 * **`pending` is deliberately not counted**, and this is the one decision in here worth not
 * relitigating. A *non-isolated* (checkout) feature run stays `pending` forever by design — the
 * platform never system-merges one, so `pending` there is the honest answer rather than a stuck
 * state (see the runner notes in CLAUDE.md). Summarising it would put a "3 pending" chip on the
 * heading of every feature whose work ran in the checkout, which reads as a queue that is never
 * going to drain. The per-row chip still renders (via `mergeChipView`), so nothing is hidden —
 * what's dropped is only the *aggregate*, which is where the false impression came from.
 *
 * `blocked` **is** counted, because unlike `pending` it genuinely is a queue that drains: the
 * sweep retries it whenever the project frees up. `no_commits` is not — there is nothing
 * anyone or anything is going to do with it.
 *
 * Returns zeroes rather than null so a caller can render the chips conditionally without a
 * null check; `hasMergeSummary` is the "is there anything to show" test.
 */
export function featureMergeSummary(
  states: readonly (TaskMergeState | null | undefined)[],
): { merged: number; conflict: number; blocked: number } {
  let merged = 0;
  let conflict = 0;
  let blocked = 0;
  for (const s of states) {
    if (s === "merged") merged += 1;
    else if (s === "conflict") conflict += 1;
    else if (s === "blocked") blocked += 1;
  }
  return { merged, conflict, blocked };
}

export const hasMergeSummary = (s: {
  merged: number;
  conflict: number;
  blocked: number;
}): boolean => s.merged > 0 || s.conflict > 0 || s.blocked > 0;

/** A feature as the management card sees it — enough to decide what may be done to it. */
export type FeatureAdmin = {
  status: FeatureStatus;
  /** Set when the backlog sync derived this from a `.pm/tasks/<request>/` folder. */
  sourceDir: string | null;
};

/**
 * Which actions a feature row offers, and — when one is withheld — why.
 *
 * The "why" is the point. A row that silently omits Rename and Delete for a sync-derived
 * feature looks broken; the same row saying its name comes from `.pm/tasks/…/index.md` tells
 * the user where to go instead. Both refusals are enforced server-side as well
 * (`folderOwnedFeatureEdits`, `deleteFeature`); this is only what stops a click becoming a 409
 * the user can do nothing with.
 *
 * Deliberately *not* consulting live tasks. The other delete refusal — a run still in flight —
 * depends on rows this shared page can't scope to the reader, and it changes second to second.
 * That one stays a server-side 409, surfaced as the error on the attempt.
 */
export type FeatureRowActions = {
  canRename: boolean;
  canDelete: boolean;
  /**
   * The `.pm/tasks/<request>/` folder this row was derived from, when it was one — the fact
   * that genuinely differs per row, and the thing a user needs in order to go and edit it.
   * The *reason* it can't be edited here is `FILE_OWNED_FEATURE_NOTE`, said once per card.
   */
  sourceDir: string | null;
  /** Closing out and reopening are always offered: no file has an opinion about status. */
  canClose: boolean;
  canReopen: boolean;
};

/**
 * Why some rows withhold Rename and Delete. Rendered **once per card**, not per row.
 *
 * It started as a sentence on every derived row, which reads fine for one and is a wall of text
 * for a project planned by pm — measured on this repo, all twelve features were derived, so the
 * list carried twenty-four lines of the same explanation. The folder path varies per row and
 * stays there; the rule does not.
 */
export const FILE_OWNED_FEATURE_NOTE =
  "Features planned by /pm are named by their folder's index.md and are re-derived on every backlog load, so they can't be renamed or deleted here — change the folder instead. Closing one out still works.";

export function featureRowActions(f: FeatureAdmin): FeatureRowActions {
  const derived = f.sourceDir !== null && f.sourceDir !== "";
  return {
    canRename: !derived,
    canDelete: !derived,
    sourceDir: derived ? f.sourceDir : null,
    canClose: f.status === "active",
    canReopen: f.status !== "active",
  };
}

/**
 * Whether a feature group starts expanded. Active features (and the ungrouped bucket, whose
 * `feature` is null) do — they are the work in flight, the thing the reader came for. Closed
 * features start collapsed: their rows are history, and on a long-lived project they would
 * otherwise push every live group below the fold. The heading itself always renders, so
 * nothing is hidden — collapsed is a default, not a filter.
 */
export function featureGroupDefaultOpen(
  feature: { status: FeatureStatus } | null,
): boolean {
  return feature === null || feature.status === "active";
}

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
 * Why a report might warrant a follow-up fix task — **with the line that says so**.
 *
 * This replaced a boolean (`reportHasFindings`) that decided the same thing and could not
 * explain itself. That asymmetry was the whole bug: the report card rendered a "Create fix
 * task" button next to any report the heuristic liked, with nothing anywhere saying *what*
 * needed fixing, so the honest reaction to it was "why do I need a fix task?". A report
 * describing bugs it had already **fixed** matched `bugs?` and got the button just the same.
 *
 * So the button and its explanation now come from one list. No reasons → no button (it can't
 * appear unexplained); reasons → the card quotes them. Guessing at prose is still guessing —
 * but a guess a person can see and overrule is worth far more than a silent one.
 *
 * Deliberately per-line rather than over the whole blob: a line is what can be quoted back,
 * and "no outstanding issues" has to be judged as its own sentence rather than lighting up
 * `issues?` for the entire report. It had **no specs at all** before this.
 */
export type FixTaskReason = {
  /** Which signal fired, as a short label for the callout. */
  label: string;
  /** The line that fired it — the "why", quoted. */
  evidence: string;
};

/** Enough to explain the button; more turns the callout into a second copy of the report. */
const MAX_FIX_REASONS = 4;
const MAX_EVIDENCE_CHARS = 160;

/** Headings that enumerate outstanding work. */
const FINDING_HEADING =
  /^\s*(?:#{1,6}\s*|\*\*\s*)?(?:findings?|issues?|bugs?|blocking|recommendations?|follow[-\s]?ups?|action (?:needed|required|items?)|remaining work|out of scope|known gaps?)\b/i;
/** Severity callouts — emoji, "[high]", or a "Critical:"-style line label. */
const SEVERITY_LINE =
  /(?:^|\s)(?:[🔴🟠🟡]|\[\s*(?:critical|high|medium|low)\s*\]|(?:critical|high|medium|low)\s*[:\-—])/i;
const RECOMMENDATION_LINE =
  /\b(?:recommend|suggest|you (?:should|could|may want to)|should (?:fix|address|consider|update|remove)|must (?:fix|address)|needs? to be (?:fixed|addressed)|left (?:unfixed|unresolved)|did not (?:fix|address)|consider (?:fixing|adding|removing))\b/i;
const UNCHECKED_TODO = /^\s*[-*]\s*\[ \]/;
const ALL_CLEAR_LINE =
  /\b(?:no (?:real |outstanding |open |remaining |unresolved |blocking )?(?:issues?|bugs?|findings?|vulnerabilit\w+|problems?|secrets?|concerns?|regressions?)|nothing (?:to fix|blocking|actionable|of note|to address)|no action (?:needed|required)|0 (?:critical|high|blocking)|all clear|looks good|lgtm)\b/i;

/**
 * A quotable line: markdown furniture off, non-printing characters out, capped by code point.
 *
 * **The control-character strip is a security control, not tidiness.** A report is written by an
 * agent and can be steered by a file or a web page that agent read, and this text is quoted into
 * a callout whose entire purpose is to be read and trusted before someone clicks a button. A
 * `U+202E` RIGHT-TO-LEFT OVERRIDE survives React's escaping untouched (escaping is about markup,
 * not about Unicode), so the quoted line could be made to *display* as something other than what
 * it says — Trojan Source, in the one place designed to be believed. The security audit
 * reproduced it. `\p{Cf}` covers the bidi embeddings, overrides and isolates plus zero-width
 * joiners and the BOM; `\p{Cc}` covers the C0/C1 controls that aren't ordinary whitespace.
 *
 * Tabs and friends become a space first, so stripping can't glue two words together.
 */
function evidenceOf(line: string): string {
  const text = line
    .replace(/^\s*(?:[-*+•>]\s+|\d+[.)]\s+|#{1,6}\s+)/, "")
    .replace(/^\s*\[\s*\]\s*/, "")
    .replace(/\*\*/g, "")
    // Real whitespace first, so removing the rest below can't glue two words together.
    // Escapes only, never literal bytes: U+2028/U+2029 are line terminators in JS source, so
    // pasting them here broke the parser outright the first time.
    .replace(/[\t\v\f\r\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Cut by code point, never `slice`: a UTF-16 cut splits a surrogate pair into U+FFFD.
  const chars = [...text];
  if (chars.length <= MAX_EVIDENCE_CHARS) return text;
  return `${chars.slice(0, MAX_EVIDENCE_CHARS - 1).join("")}…`;
}

export function fixTaskReasons(report: string): FixTaskReason[] {
  const reasons: FixTaskReason[] = [];
  const seen = new Set<string>();

  for (const raw of report.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const label = UNCHECKED_TODO.test(line)
      ? "Unfinished item"
      : SEVERITY_LINE.test(line)
        ? "Severity callout"
        : FINDING_HEADING.test(line)
          ? "Findings section"
          : RECOMMENDATION_LINE.test(line)
            ? "Recommendation"
            : null;
    if (!label) continue;
    // "No outstanding issues" matches `issues?` and is the *opposite* of a finding. A
    // severity tag still wins on its own line — that's an explicit grading, not prose.
    if (label !== "Severity callout" && ALL_CLEAR_LINE.test(line)) continue;
    // One entry per kind: an audit lists twenty findings, and twenty near-identical rows in a
    // callout is a wall of text where the point was "here is why the button is there".
    if (seen.has(label)) continue;
    seen.add(label);
    reasons.push({ label, evidence: evidenceOf(line) });
    if (reasons.length >= MAX_FIX_REASONS) break;
  }
  return reasons;
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
