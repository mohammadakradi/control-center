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
  isOpenBacklogStatus,
  orderSkills,
  statusColor,
  taskDisplayTitle,
} from "./ui";
import type { BacklogStatus } from "./db/schema";

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
