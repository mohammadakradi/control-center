/**
 * `featureBranchPreamble` — the only guarantee a non-isolated (checkout) feature run gets
 * that its work lands on the feature branch, since the platform never system-merges one (see
 * `launchMode`'s `feature` docstring). Pure string-building plus one DB read, so it's worth
 * pinning directly rather than only through a live dispatch.
 *
 * Runs against a throwaway SQLite file built from the real schema via `drizzle-kit push`,
 * never the app's own `data/platform.db` — the same pattern `backlog-tool.test.ts` uses.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "platform-session-manager-test-"));
const dbFile = join(dir, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;
// featureBranchPreamble doesn't touch secrets, but importing session-manager.ts transitively
// imports modules that read this at call time (never at import time) — set it anyway so a
// future change that does read it earlier fails obviously rather than mysteriously.
process.env.SECRETS_MASTER_KEY = Buffer.alloc(32).toString("base64");

type Db = typeof import("../lib/db").db;
type Schema = typeof import("../lib/db/schema");
let db: Db;
let features: Schema["features"];
let featureBranchPreamble: typeof import("./session-manager").featureBranchPreamble;
let mergeResolvePrompt: typeof import("./session-manager").mergeResolvePrompt;
let resultAction: typeof import("./session-manager").resultAction;
let gateAction: typeof import("./session-manager").gateAction;
let replyAction: typeof import("./session-manager").replyAction;
let recordAllowed: typeof import("./session-manager").recordAllowed;
let nudgePrompt: typeof import("./session-manager").nudgePrompt;
let makeInputChannel: typeof import("./session-manager").makeInputChannel;

before(async () => {
  execFileSync(
    "npx",
    [
      "drizzle-kit",
      "push",
      "--dialect=sqlite",
      "--schema=./lib/db/schema.ts",
      `--url=${dbFile}`,
      "--force",
    ],
    { cwd: join(import.meta.dirname, ".."), stdio: "pipe" },
  );

  ({ db } = await import("../lib/db"));
  ({ features } = await import("../lib/db/schema"));

  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  ({
    featureBranchPreamble,
    mergeResolvePrompt,
    resultAction,
    gateAction,
    replyAction,
    recordAllowed,
    nudgePrompt,
    makeInputChannel,
  } = await import("./session-manager"));

  const { projects } = await import("../lib/db/schema");
  db.insert(projects).values({ id: "p1", name: "One", path: join(dir, "one") }).run();
  db.insert(features)
    .values({ id: "f1", projectId: "p1", name: "Invoice approval", branch: "feature/invoice-approval" })
    .run();
});

after(() => rmSync(dir, { recursive: true, force: true }));

test("names the feature and its branch, and states the platform won't merge for it", () => {
  const text = featureBranchPreamble("f1");
  assert.match(text, /feature "Invoice approval"/);
  assert.match(text, /`feature\/invoice-approval`/);
  assert.match(text, /will not merge/);
});

test("degrades to silence when the feature is gone", () => {
  // `featureId`'s FK is `set null` — a task can briefly carry a ref to a deleted feature
  // between the delete and that update landing. Naming a branch that no longer means
  // anything would be worse than saying nothing.
  assert.equal(featureBranchPreamble("f_does_not_exist"), "");
});

// ---------------------------------------------------------------- resultAction

/** A fully-"complete" input, so each test flips exactly the one field it is about. */
const baseResult = {
  swallow: false,
  isError: false,
  done: false,
  pendingApproval: false,
  hasGate: false,
  paused: false,
  canNudge: true,
};

test("resultAction: swallow wins over an error subtype — the fix for the orphaned resolve turn", () => {
  // The bug (correctness review, 2026-08-22): after a mid-turn [[DONE]] pushes the
  // conflict-resolve turn, the ended turn's own result is stale and must be eaten. If that
  // result carried an error subtype, the error branch used to fire first, sealing the task
  // `failed` and orphaning the resolve turn. Swallow must come first, whatever the subtype.
  assert.equal(resultAction({ ...baseResult, swallow: true, isError: true }), "swallow");
  assert.equal(resultAction({ ...baseResult, swallow: true, done: true }), "swallow");
  assert.equal(
    resultAction({ ...baseResult, swallow: true, isError: true, paused: true, hasGate: true }),
    "swallow",
    "swallow beats every other signal",
  );
});

test("resultAction: precedence below swallow — error, then done, then await/gate/nudge/complete", () => {
  assert.equal(resultAction({ ...baseResult, isError: true }), "fail");
  assert.equal(resultAction({ ...baseResult, isError: true, done: true }), "fail", "error still reported (finalize no-ops if done)");
  assert.equal(resultAction({ ...baseResult, done: true }), "none");
  assert.equal(resultAction({ ...baseResult, pendingApproval: true }), "await");
  assert.equal(resultAction({ ...baseResult, hasGate: true }), "gate");
  assert.equal(resultAction({ ...baseResult, pendingApproval: true, hasGate: true }), "await", "a live tool gate beats a prose marker");
  assert.equal(resultAction({ ...baseResult, paused: true, canNudge: true }), "nudge");
  assert.equal(resultAction({ ...baseResult, paused: true, canNudge: false }), "pause-fail");
  assert.equal(resultAction(baseResult), "complete");
});

// ------------------------------------------------------------------ gateAction

/** A live, healthy session — each test flips only the field it is about. */
const baseGate = {
  sealed: false,
  current: true,
  inputLive: true,
  cancelled: false,
  treeGone: false,
  checkoutTaken: false,
};

test("gateAction: a gate on a live run is just delivered", () => {
  assert.equal(gateAction(baseGate), "deliver");
  // Nothing about a *live* run can turn a gate away, whatever else is set.
  assert.equal(
    gateAction({
      ...baseGate,
      cancelled: true,
      treeGone: true,
      inputLive: false,
      checkoutTaken: true,
    }),
    "deliver",
  );
});

test("gateAction: a gate from an agent the runner already sealed re-opens the task", () => {
  // The bug this exists for: the turn was sealed on a tool-call preamble, finalize() closed
  // the input channel, and the next request_approval died with `Stream closed` — the user
  // got a report on a finished task instead of the proposal the agent was raising.
  assert.equal(gateAction({ ...baseGate, sealed: true }), "reopen");
});

test("gateAction: refuses when honouring the gate could not work — or would undo a cancel", () => {
  // No live session to deliver the decision to.
  assert.equal(gateAction({ ...baseGate, sealed: true, current: false }), "refuse");
  assert.equal(gateAction({ ...baseGate, sealed: true, inputLive: false }), "refuse");
  // The user stopped this task; a late gate must not resurrect it.
  assert.equal(gateAction({ ...baseGate, sealed: true, cancelled: true }), "refuse");
  // The worktree went back, so the agent's cwd no longer exists.
  assert.equal(gateAction({ ...baseGate, sealed: true, treeGone: true }), "refuse");
  // Found in review: `finalize` calls `promoteNext`, so a checkout-mode run's directory can
  // already belong to the next queued job by the time a late gate lands. Re-opening there
  // would put two live agents in one working tree — worse than the stranded gate.
  assert.equal(
    gateAction({ ...baseGate, sealed: true, checkoutTaken: true }),
    "refuse",
  );
});

// ------------------------------------------------- request_approval's refusal path

/**
 * `gateAction` deciding "refuse" is only half the fix: the refusal has to reach the *agent*.
 * `onGate` rejects, and the gate tool must turn that into an `isError` tool result — the one
 * thing an agent can actually read and act on. If it ever went back to throwing, the agent
 * would see an SDK-level failure again, which is the `Stream closed` symptom this task exists
 * to remove. Driven through the real tool definition (as backlog-tool.test.ts does).
 */
const gateTool = async (onGate: () => Promise<{ allow: boolean; feedback?: string }>) => {
  const { platformTools } = await import("./platform-mcp");
  const def = platformTools({ onGate, backlog: { projectId: "p1" } })[0];
  assert.equal(def.name, "request_approval");
  return (args: Record<string, unknown>) =>
    def.handler(args as never, undefined) as Promise<{
      content: { text: string }[];
      isError?: boolean;
    }>;
};

test("request_approval: a gate that cannot be raised comes back as a readable tool error", async () => {
  const call = await gateTool(async () => {
    throw new Error(
      "This run has already ended (done) and its session cannot be re-opened, so the proposal gate could not be raised. Your summary was recorded in the task's transcript. Do not retry — end your turn.",
    );
  });
  const res = await call({ gate: "proposal", summary: "Here is my plan." });
  assert.equal(res.isError, true, "must be an error result, not a normal one");
  // The agent is told what happened, that its summary survived, and not to loop on it.
  assert.match(res.content[0].text, /already ended/);
  assert.match(res.content[0].text, /recorded in the task's transcript/);
  assert.match(res.content[0].text, /Do not retry/);
});

test("request_approval: a decision still comes back as an ordinary result", async () => {
  // The refusal branch must not have swallowed the normal path.
  const yes = await (await gateTool(async () => ({ allow: true })))({
    gate: "report",
    summary: "Done.",
  });
  assert.equal(yes.isError, undefined);
  assert.match(yes.content[0].text, /APPROVED/);

  const no = await (await gateTool(async () => ({ allow: false, feedback: "split it" })))({
    gate: "proposal",
    summary: "Plan.",
  });
  assert.equal(no.isError, undefined, "a rejection is an answer, not a tool failure");
  assert.match(no.content[0].text, /did NOT approve[\s\S]*split it/);
});

// ----------------------------------------------------- replyAction / recordAllowed

test("replyAction: a pending gate wins, a sealed session refuses rather than pretends", () => {
  assert.equal(replyAction({ pendingApproval: true, done: false }), "gate");
  assert.equal(replyAction({ pendingApproval: true, done: true }), "gate");
  assert.equal(replyAction({ pendingApproval: false, done: false }), "push");
  // Was: push into a closed input channel and set the task to `building` — a finished task
  // that then sits in "building" forever, having acknowledged a reply nobody received.
  assert.equal(replyAction({ pendingApproval: false, done: true }), "refuse");
});

test("recordAllowed: nothing is persisted after the terminal end", () => {
  assert.equal(recordAllowed({}), true);
  assert.equal(recordAllowed({ sealed: false }), true);
  // Late subagent/background messages land nowhere once `end` has been written.
  assert.equal(recordAllowed({ sealed: true }), false);
});

// -------------------------------------------------------------- makeInputChannel

/** The SDK only takes `SDKUserMessage`s; the shape doesn't matter to the channel. */
const msg = (text: string) =>
  ({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null }) as never;

test("input channel: a close is not instant — a re-open inside the grace keeps the stream", async () => {
  // The whole point: `finalize` closes the input, and the agent's next request_approval used
  // to hit a channel that had already ended (`Stream closed`). The grace is what leaves a
  // session for `gateAction`'s "reopen" to answer into.
  const ch = makeInputChannel(50);
  const gen = ch.gen();
  ch.push(msg("first"));
  assert.equal((await gen.next()).done, false);

  ch.close();
  assert.equal(ch.isLive(), true, "still live during the grace");
  ch.reopen();
  ch.push(msg("the user's answer to the re-opened gate"));
  const answer = await gen.next();
  assert.equal(answer.done, false, "a message pushed after a re-open is delivered");
  assert.equal(ch.isLive(), true);

  // And a re-opened channel can be closed again for real.
  ch.close();
  assert.equal((await gen.next()).done, true);
  assert.equal(ch.isLive(), false, "the generator has returned — nothing revives it");
  ch.reopen();
  assert.equal(ch.isLive(), false, "re-opening a returned generator is not a resurrection");
});

test("input channel: the grace expires on its own, and a message inside it doesn't wait it out", async () => {
  const ch = makeInputChannel(30);
  const gen = ch.gen();
  ch.close();
  // Nobody re-opens: the stream ends by itself rather than holding the session open.
  assert.equal((await gen.next()).done, true);
  assert.equal(ch.isLive(), false);

  // A push during the grace is delivered immediately — the timer must be interruptible, or
  // the user's answer would sit for the whole window.
  const ch2 = makeInputChannel(10_000);
  const gen2 = ch2.gen();
  ch2.close();
  ch2.reopen();
  const started = process.hrtime.bigint();
  ch2.push(msg("answer"));
  assert.equal((await gen2.next()).done, false);
  const waitedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(waitedMs < 1_000, `delivered in ${waitedMs.toFixed(1)}ms, not after the grace`);
});

// ------------------------------------------------------------------ nudgePrompt

test("nudgePrompt: each pause reason describes the stop the agent actually made", () => {
  const carryOn = /continue this SAME task|request_approval/;
  for (const reason of ["waiting", "narration", "no-text", "unfinished"] as const) {
    assert.match(nudgePrompt(reason), carryOn, reason);
  }
  assert.match(nudgePrompt("waiting"), /sub-tasks\/reviews have completed/);
  // The new reason: prose that reported nothing. Telling this agent its "sub-tasks have
  // completed" (it dispatched none) reads as the platform being confused.
  assert.match(nudgePrompt("unfinished"), /step along the way/);
  assert.doesNotMatch(nudgePrompt("unfinished"), /sub-tasks/);
  assert.match(nudgePrompt("narration"), /announced what you were about to do/);
});

test("mergeResolvePrompt: exact merge command, both-sides rule, and no workflow re-entry", () => {
  // This text is the only steering the automatic conflict-resolution turn gets, so the
  // load-bearing lines are pinned: the literal command (the agent must merge the feature
  // branch INTO its own branch — the platform then re-merges the other way), the
  // never-discard-either-side rule the user asked for by name, and the instructions that
  // keep a workflow-trained agent from treating this as a fresh task (no gates, no push).
  const text = mergeResolvePrompt("Invoice approval", "feature/invoice-approval");
  assert.match(text, /`git merge feature\/invoice-approval`/);
  assert.match(text, /feature "Invoice approval"/);
  assert.match(text, /[Nn]ever discard/);
  assert.match(text, /[Dd]o not open an approval gate/);
  assert.match(text, /do not push/);
  assert.match(text, /\[\[DONE\]\]/, "must tell the agent how to end the turn cleanly");
});
