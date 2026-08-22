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

  ({ featureBranchPreamble, mergeResolvePrompt, resultAction } = await import(
    "./session-manager"
  ));

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
