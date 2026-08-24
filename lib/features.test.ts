/**
 * Specs for the feature entity.
 *
 * Three properties carry it. The branch a feature reserves is a **git ref**, so its slug is an
 * allowlist that must never emit a name git could read as an option or a path — that is the
 * security-relevant half and it is asserted directly rather than assumed from the regex.
 * Deriving a feature from a `.pm/tasks/` folder is idempotent, so it can run on every backlog
 * load. And a `featureId` from a client is only ever accepted for the project it belongs to,
 * which is what stops work being linked across projects.
 *
 * Runs against a throwaway SQLite file built from the committed migrations — never
 * `data/platform.db`.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-features-test-"));
const dbFile = join(root, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

type Features = typeof import("./features");
type Schema = typeof import("./db/schema");
let features: Features;
let db: typeof import("./db").db;
let schema: Schema;
let eq: typeof import("drizzle-orm").eq;

before(async () => {
  const { migrateDatabase } = await import("./db/migrate");
  migrateDatabase({
    dbPath: dbFile,
    migrationsFolder: resolve(import.meta.dirname, "..", "drizzle"),
    backup: false,
  });

  features = await import("./features");
  ({ db } = await import("./db"));
  schema = await import("./db/schema");
  ({ eq } = await import("drizzle-orm"));

  // Guard: if the env override ever stopped working, fail loudly rather than writing to the
  // real database.
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  db.insert(schema.projects).values({ id: "p1", name: "P1", path: join(root, "p1") }).run();
  db.insert(schema.projects).values({ id: "p2", name: "P2", path: join(root, "p2") }).run();
  db.insert(schema.agents)
    .values({ id: "a1", name: "swe", namespace: "swe", sourcePath: root, pluginId: "swe" })
    .run();
});

after(() => rmSync(root, { recursive: true, force: true }));

function makeTask(id: string, projectId = "p1", featureId: string | null = null) {
  db.insert(schema.tasks)
    .values({ id, projectId, agentId: "a1", command: "task", featureId })
    .run();
}

// ------------------------------------------------------------------ slugging

test("a slug keeps words and drops everything a refname can't hold", () => {
  assert.equal(features.featureSlug("Checkout flow"), "checkout-flow");
  assert.equal(
    features.featureSlug("Feature grouping, branches & parallel runs"),
    "feature-grouping-branches-parallel-runs",
  );
  // Punctuation collapses to a single dash rather than a run of them.
  assert.equal(features.featureSlug("a  --  b"), "a-b");
});

test("a slug can never be read by git as an option, a path or a magic ref", () => {
  // Each input is a shape that would be dangerous or illegal as a ref if it survived: a
  // leading dash reads as an option, `..` and the magic characters are refused by
  // `git check-ref-format`, and a trailing `.lock` names git's own lock file.
  const hostile: [string, string][] = [
    ["--upload-pack=touch /tmp/pwn", "upload-pack-touch-tmp-pwn"],
    ["-rf", "rf"],
    ["../../etc/passwd", "etc-passwd"],
    ["a..b", "a-b"],
    ["head.lock", "head-lock"],
    ["ref~1^{}", "ref-1"],
    ["a:b?c*d[e]f\\g", "a-b-c-d-e-f-g"],
    ["with\nnewline", "with-newline"],
    ["trailing.", "trailing"],
    ["@", ""],
  ];
  for (const [input, want] of hostile) {
    const slug = features.featureSlug(input);
    assert.equal(slug, want, `slug of ${JSON.stringify(input)}`);
    assert.match(slug, /^([a-z0-9]+(-[a-z0-9]+)*)?$/, `slug of ${JSON.stringify(input)}`);
  }
});

test("a name with nothing latin in it slugs to empty, and the branch falls back to the id", () => {
  assert.equal(features.featureSlug("日本語のみ"), "");
  const feature = features.createFeature("p1", { name: "日本語のみ" })!;
  assert.equal(feature.name, "日本語のみ", "the name itself is kept as typed");
  assert.equal(
    feature.branch,
    `feature/${feature.id.replace(/^f_/, "")}`,
    "an unusable slug borrows the feature's own id, which is always ref-safe",
  );
});

test("a slug is capped, cut at a word boundary, and never ends in a dash", () => {
  const slug = features.featureSlug(`${"word ".repeat(40)}`);
  assert.ok(slug.length <= 60, `expected <= 60, got ${slug.length}`);
  assert.doesNotMatch(slug, /-$/, "a cap landing on a separator must not leave a trailing dash");
  assert.equal(slug, "word".concat("-word".repeat(11)), "whole words only");

  // A real request title, which is a sentence: the cap must not leave a half word on the end,
  // because someone has to type this ref into `git checkout`.
  assert.equal(
    features.featureSlug(
      'Fix the in-app "Update now" button so it reliably updates the app',
    ),
    "fix-the-in-app-update-now-button-so-it-reliably-updates-the",
  );

  // …but a single word longer than the cap still has to yield something, so that one is cut
  // mid-word rather than to nothing.
  const oneWord = features.featureSlug("x".repeat(200));
  assert.equal(oneWord, "x".repeat(60));
});

test("every branch this module mints is one git itself accepts", () => {
  // The allowlist is an argument; `git check-ref-format` is the authority. Run it.
  for (const name of [
    "Checkout flow",
    "--upload-pack=x",
    "a..b",
    "head.lock",
    "trailing.",
    "日本語のみ",
  ]) {
    const branch = `feature/${features.featureSlug(name) || "fallback"}`;
    execFileSync("git", ["check-ref-format", "--branch", branch], { stdio: "ignore" });
  }
});

// ------------------------------------------------------------------- naming

test("a name is flattened to one line, so it can't forge a line in a dispatched preamble", () => {
  assert.equal(features.cleanFeatureName("Two\nlines\there"), "Two lines here");
  assert.equal(features.cleanFeatureName("  padded  "), "padded");
  assert.equal(features.cleanFeatureName("\x00\x1f"), null, "control-only is not a name");
  assert.equal(features.cleanFeatureName(""), null);
  assert.equal(features.cleanFeatureName(42), null);
});

test("a name read off disk is cut by code point, not by UTF-16 unit", () => {
  const emoji = "😀".repeat(250);
  const cut = features.cleanFeatureName(emoji)!;
  assert.equal([...cut].length, 200, "200 characters, not 200 code units");
  assert.ok(!cut.includes("�"), "cutting must not split a surrogate pair");
});

// ------------------------------------------------------------------ creating

test("two features with the same name get different branches", () => {
  const one = features.createFeature("p1", { name: "Shared name" })!;
  const two = features.createFeature("p1", { name: "Shared name" })!;
  assert.equal(one.branch, "feature/shared-name");
  assert.equal(two.branch, "feature/shared-name-2");
  assert.equal(two.name, "Shared name", "only the branch is disambiguated, not the name");
});

test("the same name in another project keeps the clean branch — different repos", () => {
  const elsewhere = features.createFeature("p2", { name: "Shared name" })!;
  assert.equal(elsewhere.branch, "feature/shared-name");
});

test("past the numbered suffixes a branch falls back to the feature's own id", () => {
  // `pickBranch` tries the bare slug, then -2…-20, then gives up and uses the id. Nobody will
  // name 21 features the same thing, but the fallback is the only thing standing between that
  // and a unique-index refusal, so it should be exercised rather than assumed.
  db.insert(schema.projects)
    .values({ id: "pbranch", name: "Branches", path: join(root, "pbranch") })
    .run();
  const made = [];
  for (let n = 0; n < 21; n += 1) {
    made.push(features.createFeature("pbranch", { name: "Collide" })!);
  }
  assert.equal(made[0].branch, "feature/collide");
  assert.equal(made[1].branch, "feature/collide-2");
  assert.equal(made[19].branch, "feature/collide-20", "the last numbered slot");
  const last = made[20];
  assert.equal(
    last.branch,
    `feature/collide-${last.id.replace(/^f_/, "")}`,
    "past the numbered slots the id takes over, so a branch is always available",
  );
  // Whatever route it took, no two features in one project share a ref — two on one branch
  // would merge each other's work, which is what the unique index is really for.
  assert.equal(new Set(made.map((f) => f.branch)).size, 21);
});

test("a new feature starts active with no source folder", () => {
  const feature = features.createFeature("p1", { name: "By hand" })!;
  assert.equal(feature.status, "active");
  assert.equal(feature.sourceDir, null);
});

test("findFeaturesByIds fetches across projects, and nothing for an empty list", () => {
  // The cross-project read `/tasks` needs: that page lists one user's tasks from every project
  // at once, so resolving their features per project would be a query each. Unlike
  // `findFeature` it is deliberately not project-scoped — the ids come from `tasks.feature_id`
  // rows already scoped to the caller, never from a request.
  const here = features.createFeature("p1", { name: "Over here" })!;
  const there = features.createFeature("p2", { name: "Over there" })!;

  const found = features.findFeaturesByIds([here.id, there.id]);
  assert.deepEqual(
    found.map((f) => f.id).sort(),
    [here.id, there.id].sort(),
  );

  // An empty list must short-circuit rather than run `inArray` with no values, which is a
  // degenerate query — and an id that names nothing is simply absent, not an error.
  assert.deepEqual(features.findFeaturesByIds([]), []);
  assert.deepEqual(features.findFeaturesByIds(["f_nope"]), []);
});

test("an unusable name creates nothing", () => {
  const before = features.featureCount("p1");
  assert.equal(features.createFeature("p1", { name: "   " }), null);
  assert.equal(features.featureCount("p1"), before, "no row was written");
});

test("a real database error is not reported as a naming collision", () => {
  // `createFeature` returns null for "a unique index refused this". It must NOT also return
  // null for a genuine failure — that would surface as a misleading 409 in the API and as a
  // silently ungrouped item in the sync. A project id that doesn't exist violates the foreign
  // key, which is the cheapest real error to construct.
  const client = db.$client as unknown as { pragma(s: string): unknown };
  client.pragma("foreign_keys = ON");
  assert.throws(
    () => features.createFeature("p_does_not_exist", { name: "Orphan" }),
    /FOREIGN KEY/i,
  );
});

// --------------------------------------------------------- deriving from pm

test("deriving a request folder's feature twice returns the same row", () => {
  const dir = ".pm/tasks/20260821-120000-first";
  const first = features.ensureRequestFeature("p1", dir, "The first request")!;
  const second = features.ensureRequestFeature("p1", dir, "The first request")!;
  assert.equal(second.id, first.id);
  assert.equal(first.sourceDir, dir);
  assert.equal(
    db
      .select()
      .from(schema.features)
      .where(eq(schema.features.sourceDir, dir))
      .all().length,
    1,
    "one folder, one feature, however many times the sync runs",
  );
});

test("an edited index.md renames the feature but never moves its branch", () => {
  const dir = ".pm/tasks/20260821-130000-renamed";
  const first = features.ensureRequestFeature("p1", dir, "Original title")!;
  const renamed = features.ensureRequestFeature("p1", dir, "A much better title")!;
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.name, "A much better title");
  assert.equal(
    renamed.branch,
    first.branch,
    "the branch is a ref the runner may already have created — renaming must not orphan it",
  );
  assert.equal(first.branch, "feature/original-title");
});

test("the same folder name in two projects derives two features", () => {
  const dir = ".pm/tasks/20260821-140000-shared";
  const a = features.ensureRequestFeature("p1", dir, "Shared folder")!;
  const b = features.ensureRequestFeature("p2", dir, "Shared folder")!;
  assert.notEqual(a.id, b.id);
});

test("an unusable name leaves the folder underived rather than creating a blank feature", () => {
  assert.equal(features.ensureRequestFeature("p1", ".pm/tasks/20260821-150000-blank", " "), null);
});

// ---------------------------------------------------------------- the caps

test("the feature cap stops the sync growing the table without bound", () => {
  // A throwaway project so the cap can be reached without minting 500 rows.
  db.insert(schema.projects).values({ id: "pcap", name: "Cap", path: join(root, "cap") }).run();
  const room = features.MAX_FEATURES_PER_PROJECT;
  assert.ok(room >= 1);
  // Insert straight to the table: this is about the cap, not about branch naming.
  for (let n = 0; n < room; n += 1) {
    db.insert(schema.features)
      .values({ id: `fcap${n}`, projectId: "pcap", name: `F${n}`, branch: `feature/f${n}` })
      .run();
  }
  assert.equal(features.featureCount("pcap"), room);
  assert.equal(
    features.ensureRequestFeature("pcap", ".pm/tasks/20260821-160000-over", "Over the cap"),
    null,
    "at the cap the sync leaves items ungrouped rather than failing the load",
  );
  // But an *existing* folder's feature is still returned, or a capped project's whole backlog
  // would come unglued from its features.
  db.insert(schema.features)
    .values({
      id: "fcapkeep",
      projectId: "pcap",
      name: "Already derived",
      branch: "feature/already-derived",
      sourceDir: ".pm/tasks/20260821-170000-known",
    })
    .run();
  assert.equal(
    features.ensureRequestFeature("pcap", ".pm/tasks/20260821-170000-known", "Already derived")
      ?.id,
    "fcapkeep",
  );
});

// ------------------------------------------------------------------ scoping

test("a feature is only findable inside its own project", () => {
  const mine = features.createFeature("p1", { name: "Scoped" })!;
  assert.equal(features.findFeature("p1", mine.id)?.id, mine.id);
  assert.equal(
    features.findFeature("p2", mine.id),
    null,
    "an id from another project must read as missing, not as forbidden",
  );
});

test("a featureId from another project is refused, not silently accepted", () => {
  const other = features.createFeature("p2", { name: "Someone else's feature" })!;
  const refused = features.parseFeatureRef("p1", other.id);
  assert.equal(refused.ok, false);
  const accepted = features.parseFeatureRef("p2", other.id);
  assert.deepEqual(accepted, { ok: true, value: other.id });
});

test("a featureId that names nothing is refused", () => {
  assert.equal(features.parseFeatureRef("p1", "f_deadbeef").ok, false);
  assert.equal(features.parseFeatureRef("p1", 7).ok, false);
});

test("absent means leave alone, null and empty string mean unassign", () => {
  assert.deepEqual(features.parseFeatureRef("p1", undefined), { ok: true, value: undefined });
  assert.deepEqual(features.parseFeatureRef("p1", null), { ok: true, value: null });
  assert.deepEqual(features.parseFeatureRef("p1", ""), { ok: true, value: null });
});

test("listFeatures only returns its own project's", () => {
  const ids = features.listFeatures("p2").map((f) => f.id);
  const p1 = features.listFeatures("p1").map((f) => f.id);
  assert.ok(ids.length > 0 && p1.length > 0);
  assert.equal(
    ids.some((id) => p1.includes(id)),
    false,
  );
});

// ------------------------------------------------------------------ editing

test("a status edit is validated against the allowlist", () => {
  assert.deepEqual(features.parseFeatureEdit({ status: "done" }), {
    ok: true,
    value: { status: "done" },
  });
  assert.equal(features.parseFeatureEdit({ status: "archived" }).ok, false);
  assert.equal(features.parseFeatureEdit({ status: 1 }).ok, false);
});

test("an over-long name is refused rather than quietly truncated", () => {
  const parsed = features.parseFeatureEdit({ name: "x".repeat(201) });
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok === false ? parsed.error : "", /200 characters/);
});

test("a new feature needs a name; an edit doesn't", () => {
  assert.equal(features.parseNewFeature({ status: "done" }).ok, false);
  assert.deepEqual(features.parseNewFeature({ name: " Trimmed " }), {
    ok: true,
    value: { name: "Trimmed" },
  });
  assert.deepEqual(features.parseFeatureEdit({}), { ok: true, value: {} });
});

test("branch and sourceDir are not editable through the API", () => {
  const parsed = features.parseFeatureEdit({
    branch: "feature/forged",
    sourceDir: ".pm/tasks/20260821-180000-forged",
    name: "Fine",
  });
  assert.deepEqual(parsed, { ok: true, value: { name: "Fine" } }, "both are dropped");
});

test("updateFeature writes name and status and leaves the branch alone", () => {
  const feature = features.createFeature("p1", { name: "Editable" })!;
  const updated = features.updateFeature(feature.id, { name: "Edited", status: "done" });
  assert.equal(updated.name, "Edited");
  assert.equal(updated.status, "done");
  assert.equal(updated.branch, feature.branch);
});

test("a sync-derived feature's name belongs to its folder", () => {
  assert.deepEqual(features.folderOwnedFeatureEdits({ name: "Renamed" }), ["name"]);
  assert.deepEqual(features.folderOwnedFeatureEdits({ status: "done" }), []);
});

// ------------------------------------------------------- assigning to tasks

test("a task can be assigned to a feature and unassigned again", () => {
  const feature = features.createFeature("p1", { name: "Task holder" })!;
  makeTask("t_assign");
  assert.equal(features.setTaskFeature("t_assign", feature.id)?.featureId, feature.id);
  assert.equal(features.setTaskFeature("t_assign", null)?.featureId, null);
});

test("hand-grouping a task gives it a merge state, and ungrouping takes pending back", () => {
  // The invariant everywhere else is "mergeState null ⇔ no feature" (dispatch sets pending
  // the moment a featureId is attached). A task grouped *after* dispatch used to stay null
  // forever — indistinguishable from ungrouped, so the merge chip silently omitted itself.
  const feature = features.createFeature("p1", { name: "Late grouping" })!;
  makeTask("t_late");
  assert.equal(features.setTaskFeature("t_late", feature.id)?.mergeState, "pending");
  assert.equal(features.setTaskFeature("t_late", null)?.mergeState, null);
});

test("ungrouping always clears mergeState — the sweep can never reach a feature-less row", () => {
  // The invariant the merge sweep depends on: it joins through featureId, so a row with no
  // feature is unreachable. A leftover "blocked"/"conflict" would render a chip claiming an
  // automatic retry that nothing will ever perform (correctness review, 2026-08-22).
  const feature = features.createFeature("p1", { name: "Reachable" })!;
  makeTask("t_blocked", "p1", feature.id);
  db.update(schema.tasks)
    .set({ mergeState: "blocked" })
    .where(eq(schema.tasks.id, "t_blocked"))
    .run();
  assert.equal(features.setTaskFeature("t_blocked", null)?.mergeState, null);
});

test("moving a task to a different feature resets a stale outcome to pending", () => {
  // "merged" describes a merge against the *old* feature's branch; carrying it onto feature
  // B's heading would read as "this work is in B's branch" when it isn't. An unchanged
  // (idempotent) feature keeps the outcome.
  const a = features.createFeature("p1", { name: "Origin" })!;
  const b = features.createFeature("p1", { name: "Destination" })!;
  makeTask("t_outcome", "p1", a.id);
  db.update(schema.tasks)
    .set({ mergeState: "merged" })
    .where(eq(schema.tasks.id, "t_outcome"))
    .run();
  assert.equal(features.setTaskFeature("t_outcome", a.id)?.mergeState, "merged", "same feature keeps it");
  assert.equal(features.setTaskFeature("t_outcome", b.id)?.mergeState, "pending", "moved → pending");
});

test("closing out a feature never deletes the work recorded under it", () => {
  // The FK is `set null`, which is what keeps history when a feature row goes away. The
  // migration has to actually say so — drizzle-kit omits `ON DELETE` from an ALTER TABLE, so
  // this asserts the committed SQL, not the ORM's intent.
  const feature = features.createFeature("p1", { name: "Doomed" })!;
  makeTask("t_orphan", "p1", feature.id);
  db.insert(schema.backlogItems)
    .values({ id: "bli_orphan", projectId: "p1", title: "Held", featureId: feature.id })
    .run();

  const client = db.$client as unknown as { pragma(s: string): unknown };
  client.pragma("foreign_keys = ON");
  db.delete(schema.features).where(eq(schema.features.id, feature.id)).run();

  assert.equal(
    db.select().from(schema.tasks).where(eq(schema.tasks.id, "t_orphan")).get()?.featureId,
    null,
    "the task survives with no feature",
  );
  assert.equal(
    db
      .select()
      .from(schema.backlogItems)
      .where(eq(schema.backlogItems.id, "bli_orphan"))
      .get()?.featureId,
    null,
  );
});

// ------------------------------------------------------------ deleting one

/** A task that has *finished*. `makeTask` leaves the column at its default, `queued`, which
 *  counts as a live run — so a fixture built with it is refused by `deleteFeature`, correctly. */
function makeDoneTask(id: string, projectId = "p1", featureId: string | null = null) {
  makeTask(id, projectId, featureId);
  db.update(schema.tasks).set({ status: "done" }).where(eq(schema.tasks.id, id)).run();
}

test("deleting a feature ungroups its work instead of destroying it", () => {
  const feature = features.createFeature("p1", { name: "Retire me" })!;
  makeDoneTask("t_del_a", "p1", feature.id);
  makeDoneTask("t_del_b", "p1", feature.id);
  db.insert(schema.backlogItems)
    .values({ id: "bli_del", projectId: "p1", title: "Planned", featureId: feature.id })
    .run();

  const res = features.deleteFeature(feature);
  assert.equal(res.ok, true);
  assert.ok(res.ok && res.ungrouped.tasks === 2, "reports what it handed back");
  assert.ok(res.ok && res.ungrouped.items === 1);
  assert.ok(res.ok && res.branch === feature.branch, "names the branch it did NOT delete");

  assert.equal(features.findFeature("p1", feature.id), null, "the row is gone");
  // The whole point: closing out or deleting a grouping must never delete the work under it.
  assert.equal(
    db.select().from(schema.tasks).where(eq(schema.tasks.id, "t_del_a")).get()?.featureId,
    null,
  );
  assert.equal(
    db
      .select()
      .from(schema.backlogItems)
      .where(eq(schema.backlogItems.id, "bli_del"))
      .get()?.featureId,
    null,
    "the item survives, ungrouped",
  );
});

test("deleting a feature clears mergeState, which the FK cannot do", () => {
  // `ON DELETE SET NULL` only touches feature_id. Leaving "blocked" behind would break the
  // invariant setTaskFeature documents ("mergeState null ⇔ no feature") and render a chip
  // promising a retry the merge sweep can never perform — it joins through featureId.
  const feature = features.createFeature("p1", { name: "Merge states" })!;
  makeDoneTask("t_del_merge", "p1", feature.id);
  db.update(schema.tasks)
    .set({ mergeState: "blocked" })
    .where(eq(schema.tasks.id, "t_del_merge"))
    .run();

  assert.equal(features.deleteFeature(feature).ok, true);
  const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, "t_del_merge")).get();
  assert.equal(row?.featureId, null);
  assert.equal(row?.mergeState, null, "an ungrouped row must never carry a merge state");
});

test("a sync-derived feature is refused rather than deleted", () => {
  // ensureRequestFeature re-derives one per .pm/tasks/<request>/ folder on the next backlog
  // load, so deleting it would appear to work and then silently undo itself.
  const derived = features.ensureRequestFeature(
    "p1",
    ".pm/tasks/20260823-thing",
    "Planned batch",
  )!;
  const res = features.deleteFeature(derived);
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.reason === "derived");
  assert.ok(!res.ok && res.sourceDir === ".pm/tasks/20260823-thing", "names the folder to remove");
  assert.ok(features.findFeature("p1", derived.id), "and it is still there");
});

test("a feature with a live run is refused, so no merge is silently dropped", () => {
  // That run's merge-back reads featureId when it finishes (mergeOnDone) and targets this
  // branch. Pulling the row out from under it would leave committed work on task/<id> with
  // nothing pointing at it.
  const feature = features.createFeature("p1", { name: "Busy" })!;
  makeTask("t_del_live", "p1", feature.id);
  db.update(schema.tasks)
    .set({ status: "awaiting_report" }) // a gate counts as active — it's the commonest state here
    .where(eq(schema.tasks.id, "t_del_live"))
    .run();

  const res = features.deleteFeature(feature);
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.reason === "active-tasks");
  assert.ok(!res.ok && res.count === 1);
  assert.ok(features.findFeature("p1", feature.id));

  // Once the run lands, the same delete goes through.
  db.update(schema.tasks)
    .set({ status: "done" })
    .where(eq(schema.tasks.id, "t_del_live"))
    .run();
  assert.equal(features.deleteFeature(feature).ok, true);
});

test("a finished or cancelled run never blocks a delete", () => {
  const feature = features.createFeature("p1", { name: "Settled" })!;
  for (const [id, status] of [
    ["t_del_done", "done"],
    ["t_del_failed", "failed"],
    ["t_del_cancelled", "cancelled"],
  ] as const) {
    makeTask(id, "p1", feature.id);
    db.update(schema.tasks).set({ status }).where(eq(schema.tasks.id, id)).run();
  }
  const res = features.deleteFeature(feature);
  assert.equal(res.ok, true, "history is not a reason to keep the grouping");
  assert.ok(res.ok && res.ungrouped.tasks === 3);
});

test("deleting a feature leaves another project's identically-named one alone", () => {
  // The branch is only unique per project, so two projects can hold the same slug. Deleting by
  // row (never by name or branch) is what keeps them independent.
  // A name no other spec uses, so the branch really is the bare slug in both projects rather
  // than a disambiguated `-2`/`-3` left over from an earlier test.
  const mine = features.createFeature("p1", { name: "Parallel naming" })!;
  const theirs = features.createFeature("p2", { name: "Parallel naming" })!;
  assert.equal(mine.branch, theirs.branch, "same slug, different projects");

  assert.equal(features.deleteFeature(mine).ok, true);
  assert.ok(features.findFeature("p2", theirs.id), "p2's feature is untouched");
});

test("backlogCountsByFeature counts items per feature, and only this project's", () => {
  const a = features.createFeature("p1", { name: "Counted A" })!;
  const b = features.createFeature("p1", { name: "Counted B" })!;
  const other = features.createFeature("p2", { name: "Counted elsewhere" })!;
  let n = 0;
  const item = (projectId: string, featureId: string | null) =>
    db
      .insert(schema.backlogItems)
      .values({ id: `bli_count_${n++}`, projectId, title: "x", featureId })
      .run();

  item("p1", a.id);
  item("p1", a.id);
  item("p1", b.id);
  item("p1", null); // ungrouped items must not land in anyone's bucket
  item("p2", other.id);

  const counts = features.backlogCountsByFeature("p1");
  assert.equal(counts[a.id], 2);
  assert.equal(counts[b.id], 1);
  assert.equal(counts[other.id], undefined, "another project's feature is not counted here");
  // A feature with no items is absent rather than 0 — the card reads `?? 0`, and an entry per
  // feature would grow the payload for nothing.
  const empty = features.createFeature("p1", { name: "No items" })!;
  assert.equal(features.backlogCountsByFeature("p1")[empty.id], undefined);
});
