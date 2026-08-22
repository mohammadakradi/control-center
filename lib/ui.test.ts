/**
 * Unit tests for the shared UI helpers. Pure functions, no database.
 *
 * `taskDisplayTitle` is the one thing every task list in the app agrees on, so the edges
 * pinned here are the ones that would put the wrong text in front of a user: a title that
 * exists but is ignored, and an "empty" title that is really whitespace and would render as
 * a blank row.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKLOG_STATUS_LABEL,
  backlogStatusDot,
  dispatchErrorAction,
  featureGroupDefaultOpen,
  featureMergeSummary,
  featureOptions,
  groupByFeature,
  hasMergeSummary,
  isOpenBacklogStatus,
  MERGE_STATE_LABEL,
  MERGE_STATE_TITLE,
  mergeChipView,
  mergeStateTone,
  orderSkills,
  statusColor,
  taskChangesView,
  taskDisplayTitle,
} from "./ui";
import type { BacklogStatus, TaskMergeState } from "./db/schema";

/** Every backlog status, kept exhaustive by the compiler: a status added to the schema
 *  without a case here fails typecheck rather than quietly going untested. */
const ALL_BACKLOG_STATUSES: Record<BacklogStatus, true> = {
  todo: true,
  in_progress: true,
  done: true,
  cancelled: true,
};

test("taskDisplayTitle prefers the generated title over the raw request", () => {
  assert.equal(
    taskDisplayTitle({
      title: "Add invoice approval flow",
      requestText: "Please add a flow where invoices over $500 need a second approver…",
    }),
    "Add invoice approval flow",
  );
});

test("taskDisplayTitle falls back to the request text when untitled", () => {
  // Tasks that predate titling, and ones whose title generation failed, hold null.
  assert.equal(
    taskDisplayTitle({ title: null, requestText: "fix the header spacing" }),
    "fix the header spacing",
  );
  assert.equal(
    taskDisplayTitle({ requestText: "fix the header spacing" }),
    "fix the header spacing",
  );
});

test("taskDisplayTitle treats empty and whitespace-only values as absent", () => {
  // `request_text` defaults to "" in the schema, so the empty string is the common case;
  // whitespace would otherwise render as a row with no visible subject at all.
  assert.equal(taskDisplayTitle({ title: "", requestText: "" }), null);
  assert.equal(taskDisplayTitle({ title: "   ", requestText: "\n\t" }), null);
  assert.equal(taskDisplayTitle({ title: null, requestText: null }), null);
  assert.equal(taskDisplayTitle({}), null);
  assert.equal(taskDisplayTitle({ title: "  ", requestText: "real request" }), "real request");
});

test("taskDisplayTitle trims what it returns", () => {
  assert.equal(taskDisplayTitle({ title: "  Padded title \n" }), "Padded title");
});

// ------------------------------------------------------------ backlog statuses

test("every backlog status has a label and a dot", () => {
  // The page renders both for whatever the row holds, so a status added to the schema
  // without a label here would surface as a raw `in_progress` in front of a user.
  for (const status of Object.keys(ALL_BACKLOG_STATUSES) as BacklogStatus[]) {
    assert.ok(BACKLOG_STATUS_LABEL[status], `${status} has no label`);
    assert.match(backlogStatusDot(status), /^bg-(ok|danger|warn|info|muted|violet)$/);
  }
  assert.equal(BACKLOG_STATUS_LABEL.in_progress, "In progress");
});

test("open means everything that isn't done or cancelled", () => {
  // This is the split the backlog page groups by *and* the split `MAX_ITEMS_PER_PROJECT`
  // counts against — cancelling is the only way to reclaim a slot, so it has to close.
  assert.equal(isOpenBacklogStatus("todo"), true);
  assert.equal(isOpenBacklogStatus("in_progress"), true);
  assert.equal(isOpenBacklogStatus("done"), false);
  assert.equal(isOpenBacklogStatus("cancelled"), false);
});

test("backlog and task statuses agree on what a colour means", () => {
  // A backlog row and a task row can sit in the same list item, so "not started yet" must
  // not be amber in one and blue in the other.
  assert.ok(statusColor("queued").includes("info"));
  assert.equal(backlogStatusDot("todo"), "bg-info");
  assert.ok(statusColor("running").includes("warn"));
  assert.equal(backlogStatusDot("in_progress"), "bg-warn");
  assert.ok(statusColor("done").includes("ok"));
  assert.equal(backlogStatusDot("done"), "bg-ok");
  assert.ok(statusColor("cancelled").includes("muted"));
  assert.equal(backlogStatusDot("cancelled"), "bg-muted");
});

/** The skills each bundled agent actually ships, in the alphabetical order discovery hands
 *  them over (`readCommands` sorts by filename) — so these tests exercise the real input. */
const SWE_SKILLS = ["fix", "onboard", "plan", "review", "security", "ship", "task", "workspace"];
const FE_SKILLS = ["audit", "fix", "onboard", "plan", "review", "ship", "task"];

const named = (names: string[]) => names.map((name) => ({ name }));
const names = (cmds: { name: string }[]) => cmds.map((c) => c.name);

test("fe skills are offered in working order, not alphabetical", () => {
  assert.deepEqual(names(orderSkills("fe", named(FE_SKILLS), true)), [
    "task",
    "fix",
    "audit",
    "review",
    "plan",
    "ship",
  ]);
});

test("swe skills are offered in working order", () => {
  assert.deepEqual(names(orderSkills("swe", named(SWE_SKILLS), true)), [
    "task",
    "fix",
    "security",
    "review",
    "plan",
    "ship",
    "workspace",
  ]);
});

test("onboard only appears when the agent isn't onboarded, and leads when it does", () => {
  for (const [ns, skills] of [
    ["swe", SWE_SKILLS],
    ["fe", FE_SKILLS],
    ["pm", ["onboard", "plan"]],
  ] as const) {
    const onboarded = names(orderSkills(ns, named([...skills]), true));
    assert.ok(!onboarded.includes("onboard"), `${ns}: onboarded agents don't re-offer onboard`);
    const fresh = names(orderSkills(ns, named([...skills]), false));
    assert.equal(fresh[0], "onboard", `${ns}: onboarding leads until it's done`);
    assert.equal(fresh.length, skills.length, `${ns}: nothing else is dropped`);
  }
});

test("an unknown skill keeps its alphabetical place after the curated ones", () => {
  // A new command added to an agent must still show up without editing SKILL_ORDER.
  const got = names(orderSkills("fe", named(["zeta", "task", "alpha", "ship"]), true));
  assert.deepEqual(got, ["task", "ship", "alpha", "zeta"]);
});

test("an agent with no curated order is left alphabetical, minus onboard", () => {
  assert.deepEqual(names(orderSkills("dba", named(["b", "onboard", "a"]), true)), ["a", "b"]);
  assert.deepEqual(names(orderSkills(undefined, named(["b", "a"]), true)), ["a", "b"]);
});

test("orderSkills does not mutate the list it was given", () => {
  const input = named(["ship", "task"]);
  orderSkills("swe", input, true);
  assert.deepEqual(names(input), ["ship", "task"]);
});

// ------------------------------------------------------- dispatch error actions

test("a refused dispatch offers the run that is already going", () => {
  // The 409 from the backlog's run route hands back the live task; that link is the whole
  // point of the message, since the answer to "it's already running" is "so go and look".
  // The label names the noun because a 502 also returns a taskId, for a run that *failed*.
  assert.deepEqual(dispatchErrorAction({ taskId: "task_abc" }), {
    href: "/tasks/task_abc",
    label: "Open the task",
  });
});

test("a dispatch refused for a missing token points at Settings", () => {
  assert.deepEqual(dispatchErrorAction({ needsToken: true }), {
    href: "/settings",
    label: "Open Settings",
  });
});

test("a live task outranks the token hint when a body carries both", () => {
  assert.deepEqual(dispatchErrorAction({ taskId: "task_abc", needsToken: true }), {
    href: "/tasks/task_abc",
    label: "Open the task",
  });
});

test("a body with no next step gets no link, and never a broken one", () => {
  // The message has to stand on its own rather than offering a link that 404s.
  assert.equal(dispatchErrorAction({}), null);
  assert.equal(dispatchErrorAction(null), null);
  assert.equal(dispatchErrorAction(undefined), null);
  assert.equal(dispatchErrorAction({ error: "nope" } as Record<string, unknown>), null);
  assert.equal(dispatchErrorAction({ needsToken: false }), null);
  // A non-string id would interpolate to `/tasks/[object Object]` — a link that looks real.
  assert.equal(dispatchErrorAction({ taskId: { id: "x" } }), null);
  assert.equal(dispatchErrorAction({ taskId: "" }), null);
});

/**
 * `taskChangesView` — the task page's Changes card, whose branches an independent review
 * flagged as the least-verified new code. What matters in each case is that the card never
 * makes a claim the data doesn't support: a shared checkout must not read as "this task's
 * work", and a cleaned-up worktree must not read as "working tree clean".
 */
const changesOf = (n: number) => ({
  files: Array.from({ length: n }, (_, i) => ({
    path: `f${i}.ts`,
    status: "modified",
    added: 1,
    deleted: 0,
  })),
  totalAdded: n,
  totalDeleted: 0,
  truncated: 0,
});

test("taskChangesView hides the card while loading, on error, and when unavailable", () => {
  // Still loading: a card that might vanish must not flash first.
  assert.equal(taskChangesView(null).kind, "hidden");
  // A 404 body — "not yours" and "doesn't exist" are the same answer (lib/task-access).
  assert.equal(taskChangesView({ error: "not found" }).kind, "hidden");
  assert.equal(taskChangesView({ available: false, reason: "not-git" }).kind, "hidden");
  assert.equal(taskChangesView({ available: false, reason: "workspace" }).kind, "hidden");
});

test("taskChangesView reports a removed worktree as its own state, not as clean", () => {
  // "Working tree clean" would be a different — and false — claim: the work is on the branch.
  assert.deepEqual(
    taskChangesView({ available: true, scope: "worktree-removed", branch: "task/abc" }),
    { kind: "removed", branch: "task/abc" },
  );
  // A detached HEAD at cleanup stores no branch, and `undefined` must normalise to null.
  assert.deepEqual(
    taskChangesView({ available: true, scope: "worktree-removed" }),
    { kind: "removed", branch: null },
  );
});

test("taskChangesView marks only a worktree run's list as exclusively this task's", () => {
  const wt = taskChangesView({
    available: true,
    scope: "worktree",
    changes: changesOf(2),
  });
  assert.equal(wt.kind, "list");
  assert.equal(wt.kind === "list" && wt.exclusive, true);

  // The checkout is shared with whatever else runs there, so the card must caveat it.
  const co = taskChangesView({
    available: true,
    scope: "checkout",
    changes: changesOf(2),
  });
  assert.equal(co.kind === "list" && co.exclusive, false);
});

test("taskChangesView treats a missing or empty file list as empty, keeping the scope", () => {
  assert.deepEqual(taskChangesView({ available: true, scope: "worktree", changes: changesOf(0) }), {
    kind: "empty",
    scope: "worktree",
  });
  // `changes` absent entirely (a truncated/unexpected body) must not throw or render a list.
  assert.deepEqual(taskChangesView({ available: true, scope: "checkout" }), {
    kind: "empty",
    scope: "checkout",
  });
});

test("taskChangesView defaults an unknown scope to the cautious one", () => {
  // An unrecognised scope must not be treated as exclusively this task's work.
  const v = taskChangesView({ available: true, changes: changesOf(1) });
  assert.equal(v.kind === "list" && v.scope, "checkout");
  assert.equal(v.kind === "list" && v.exclusive, false);
});

/* ── Feature grouping ─────────────────────────────────────────────────────────────────────
 * `groupByFeature` decides whether three surfaces (the backlog, project detail, /tasks) grow a
 * level of hierarchy at all, and `featureMergeSummary` decides what a feature heading claims
 * about work the platform tried to merge. Both are wrong *silently* — a list still renders — so
 * they are pinned here rather than verified by looking at a page.
 */

/** Every merge state, kept exhaustive by the compiler: a state added to the schema without a
 *  case here fails typecheck rather than quietly going untested. */
const ALL_MERGE_STATES: Record<TaskMergeState, true> = {
  pending: true,
  merged: true,
  conflict: true,
  blocked: true,
  no_commits: true,
};

type Row = { id: string; featureId: string | null; mergeState?: TaskMergeState | null };

const FEATURES: Record<string, { id: string; name: string }> = {
  f_a: { id: "f_a", name: "Feature A" },
  f_b: { id: "f_b", name: "Feature B" },
};

const group = (rows: Row[]) =>
  groupByFeature(rows, (r) => (r.featureId ? FEATURES[r.featureId] : null));

test("every merge state has a label and a tone", () => {
  for (const state of Object.keys(ALL_MERGE_STATES) as TaskMergeState[]) {
    assert.equal(typeof MERGE_STATE_LABEL[state], "string");
    assert.ok(MERGE_STATE_LABEL[state].length > 0, `${state} has no label`);
    assert.ok(["ok", "warn", "muted"].includes(mergeStateTone(state)));
  }
});

test("a merge conflict is warn, not danger — the run itself may have succeeded", () => {
  // `conflict` means the *merge* failed, not the task: a task can be `done` with
  // `mergeState: "conflict"`. Toning it like a failed run would conflate the two in a list
  // that holds both, and `danger` is that list's word for a failed run.
  assert.equal(mergeStateTone("conflict"), "warn");
  assert.equal(mergeStateTone("merged"), "ok");
  // Terminal for a checkout run, so not a tone that implies "in flight".
  assert.equal(mergeStateTone("pending"), "muted");
});

test("groupByFeature returns null when nothing has a feature", () => {
  // The contract the three call sites depend on: no features means no grouping, so every list
  // in the app renders exactly as it did before this existed rather than growing one
  // information-free "No feature" heading.
  assert.equal(group([{ id: "t1", featureId: null }, { id: "t2", featureId: null }]), null);
  // An empty list is the same answer — an empty state must not become an empty group.
  assert.equal(group([]), null);
});

test("groupByFeature keeps row order and puts the ungrouped bucket last", () => {
  const groups = group([
    { id: "t1", featureId: "f_b" },
    { id: "t2", featureId: null },
    { id: "t3", featureId: "f_a" },
    { id: "t4", featureId: "f_b" },
  ]);
  assert.ok(groups);
  // Insertion order of the rows, so the caller's own ordering (newest-first) decides which
  // feature leads — no sort in here to disagree with the page's.
  assert.deepEqual(
    groups.map((g) => g.feature?.id ?? null),
    ["f_b", "f_a", null],
  );
  assert.deepEqual(groups[0].rows.map((r) => r.id), ["t1", "t4"]);
  assert.deepEqual(groups[2].rows.map((r) => r.id), ["t2"]);
});

test("groupByFeature omits the ungrouped bucket when everything is grouped", () => {
  const groups = group([
    { id: "t1", featureId: "f_a" },
    { id: "t2", featureId: "f_a" },
  ]);
  assert.equal(groups?.length, 1);
  assert.equal(groups?.[0].feature?.id, "f_a");
});

test("groupByFeature keeps a row whose feature no longer resolves", () => {
  // `tasks.feature_id` is ON DELETE SET NULL, so a row can briefly outlive its feature — and a
  // page rendering mid-delete must not drop the work, only its grouping.
  const groups = group([
    { id: "t1", featureId: "f_a" },
    { id: "t2", featureId: "f_gone" },
  ]);
  assert.ok(groups);
  assert.deepEqual(
    groups.map((g) => g.feature?.id ?? null),
    ["f_a", null],
  );
  assert.deepEqual(groups[1].rows.map((r) => r.id), ["t2"]);
});

test("featureMergeSummary counts merged, conflict and blocked — never pending or no_commits", () => {
  // Pending is excluded on purpose: a checkout-bound feature run stays pending forever by
  // design, so aggregating it would put a permanent "N pending" on the heading of every
  // feature whose work ran in the checkout. Blocked IS counted — unlike pending it is a queue
  // that genuinely drains (the sweep retries it when the project frees up). `no_commits` is
  // terminal with nothing anyone will do about it, so it stays off the heading too.
  const summary = featureMergeSummary([
    "merged",
    "pending",
    "conflict",
    "merged",
    "blocked",
    "no_commits",
    null,
    undefined,
  ]);
  assert.deepEqual(summary, { merged: 2, conflict: 1, blocked: 1 });
  assert.equal(hasMergeSummary(summary), true);
});

test("featureMergeSummary has nothing to show for pending-only or feature-less rows", () => {
  assert.equal(hasMergeSummary(featureMergeSummary(["pending", "pending"])), false);
  assert.equal(hasMergeSummary(featureMergeSummary(["no_commits"])), false);
  assert.equal(hasMergeSummary(featureMergeSummary([null, null])), false);
  assert.equal(hasMergeSummary(featureMergeSummary([])), false);
  assert.equal(hasMergeSummary(featureMergeSummary(["blocked"])), true, "blocked is worth a chip");
});

// ------------------------------------------------------------- mergeChipView

test("a recorded outcome renders as itself, with label, tone and tooltip from one vocabulary", () => {
  for (const state of ["merged", "conflict", "blocked", "no_commits"] as const) {
    const view = mergeChipView({ mergeState: state, status: "done" });
    assert.ok(view, `${state} must render`);
    assert.equal(view.state, state);
    assert.equal(view.label, MERGE_STATE_LABEL[state]);
    assert.equal(view.tone, mergeStateTone(state));
    assert.equal(view.title, MERGE_STATE_TITLE[state]);
  }
});

test("no feature, no chip", () => {
  assert.equal(mergeChipView({ mergeState: null, status: "done" }), null);
  assert.equal(mergeChipView({ mergeState: undefined, status: "running" }), null);
});

test("a cancelled or failed run gets no merge chip — no merge was ever attempted", () => {
  // The screenshot case: a cancelled task's "Not merged" chip told the user nothing except
  // that something merge-shaped might be wrong. Nothing was attempted; silence is honest.
  assert.equal(mergeChipView({ mergeState: "pending", status: "cancelled" }), null);
  assert.equal(mergeChipView({ mergeState: "pending", status: "failed" }), null);
  // …but a *recorded* outcome still shows on a cancelled continue: it really happened.
  assert.ok(mergeChipView({ mergeState: "conflict", status: "cancelled" }));
});

test("pending on a live run promises the merge; on a checkout run it explains itself", () => {
  const live = mergeChipView({ mergeState: "pending", status: "running", parallel: true });
  assert.equal(live?.label, "Merges when done");
  assert.equal(live?.tone, "muted");

  // A live run that explicitly opted out of isolation is a checkout run already.
  const queued = mergeChipView({ mergeState: "pending", status: "running", parallel: false });
  assert.equal(queued?.label, MERGE_STATE_LABEL.pending);

  // A projection that doesn't carry `parallel` (a backlog item's linked task) still promises
  // — isolation is the default, so that is the likely truth.
  const unknown = mergeChipView({ mergeState: "pending", status: "queued" });
  assert.equal(unknown?.label, "Merges when done");

  // Done + still pending ⇒ the run shared the checkout; the agent committed directly.
  const checkout = mergeChipView({ mergeState: "pending", status: "done" });
  assert.equal(checkout?.label, "In checkout");
  assert.match(checkout!.title, /nothing separate/);
});

test("featureGroupDefaultOpen: active and ungrouped start open, closed features collapsed", () => {
  assert.equal(featureGroupDefaultOpen(null), true, "the ungrouped bucket is live work");
  assert.equal(featureGroupDefaultOpen({ status: "active" }), true);
  assert.equal(featureGroupDefaultOpen({ status: "done" }), false);
  assert.equal(featureGroupDefaultOpen({ status: "cancelled" }), false);
});

test("featureOptions offers no-feature first and hides closed features", () => {
  // A closed feature's branch has been merged or abandoned, so filing new work under it would
  // reopen something every list on the site shows as finished. It stays visible in the grouped
  // lists — this bounds only where new work may be *filed*.
  const opts = featureOptions([
    { id: "f_a", name: "Feature A", branch: "feature/a", status: "active" },
    { id: "f_b", name: "Feature B", branch: "feature/b", status: "done" },
    { id: "f_c", name: "Feature C", branch: "feature/c", status: "cancelled" },
  ]);
  assert.deepEqual(
    opts.map((o) => o.value),
    ["", "f_a"],
  );
  assert.equal(opts[0].label, "No feature");
  // The branch is the description because it is what tells two similarly-named features apart,
  // and the string the user will later have to type into `git checkout`.
  assert.equal(opts[1].description, "feature/a");
});

test("featureOptions always yields the no-feature entry, so callers can gate on length", () => {
  // Both pickers decide whether to render at all by asking for more than one option — so a
  // project with no features, and one whose every feature is closed, must both come back at 1.
  assert.equal(featureOptions([]).length, 1);
  assert.equal(
    featureOptions([
      { id: "f_b", name: "Feature B", branch: "feature/b", status: "done" },
    ]).length,
    1,
  );
});
