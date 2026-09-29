/**
 * Specs for the test-scenario sync.
 *
 * Four properties carry the feature and each is asserted directly: the scan refuses to follow a
 * symlink out of the project (it reads folders an agent writes into, on an unauthenticated GET);
 * the sync is idempotent (it runs on every load, so a second run must add nothing and lose
 * nothing); a scenario passes only when a run says zero steps failed, never because a task
 * exited 0; and a status a person set by hand outranks any later automatic one.
 *
 * Archiving gets its own attention because it is the only place the platform writes into a
 * project folder: it must be reversible, and it must refuse a path that leaves the project.
 *
 * Runs against a throwaway SQLite file built from the committed migrations — never
 * `data/platform.db`.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-scenarios-test-"));
const dbFile = join(root, "test.db");
const projectDir = join(root, "project");
const outsideSecret = join(root, "outside-secret.txt");
const SECRET = "ssh-rsa AAAA-not-for-a-scenario-row";

process.env.PLATFORM_DB = dbFile;

type Mod = typeof import("./test-scenarios");
type Schema = typeof import("./db/schema");
let ts: Mod;
let db: typeof import("./db").db;
let schema: Schema;
let eq: typeof import("drizzle-orm").eq;

const QA_DIR = ".qa/scenarios";
const FE_DIR = ".fe/test-scenarios";
const SWE_DIR = ".swe/test-scenarios";

const withFeature = (name: string, title: string) => `---
feature: ${name}
auth: none
---

# Test scenario: ${title}

## Happy path
1. Open /x
   - **Expected:** it renders
`;

const plain = (title: string) => `# Test scenario: ${title}

## Happy path
1. Open /y
   - **Expected:** it renders
`;

function write(dir: string, name: string, body: string) {
  mkdirSync(resolve(projectDir, dir), { recursive: true });
  writeFileSync(resolve(projectDir, dir, name), body);
}

before(async () => {
  write(QA_DIR, "checkout.md", withFeature("Checkout flow", "Checkout happy path"));
  write(FE_DIR, "loan-simple-mode.md", plain("Loan simple mode toggle"));
  write(SWE_DIR, "project-detail-overflow.md", plain("Project detail: no horizontal scroll"));
  write(QA_DIR, "planned-later.md", withFeature("Not Yet Created", "Waiting on a feature"));
  write(FE_DIR, "notes.txt", "not markdown");

  // A scenario-shaped symlink pointing outside the project. Following it would copy the target
  // into a row every workspace on the install can read.
  writeFileSync(outsideSecret, SECRET);
  symlinkSync(outsideSecret, resolve(projectDir, FE_DIR, "sneaky.md"));

  const { migrateDatabase } = await import("./db/migrate");
  migrateDatabase({
    dbPath: dbFile,
    migrationsFolder: resolve(import.meta.dirname, "..", "drizzle"),
    backup: false,
  });

  ts = await import("./test-scenarios");
  ({ db } = await import("./db"));
  schema = await import("./db/schema");
  ({ eq } = await import("drizzle-orm"));

  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  db.insert(schema.projects).values({ id: "p1", name: "P1", path: projectDir }).run();
  db.insert(schema.agents)
    .values({ id: "a1", name: "qa", namespace: "qa", sourcePath: root, pluginId: "qa" })
    .run();
  db.insert(schema.tasks)
    .values({ id: "t1", projectId: "p1", agentId: "a1", command: "test", status: "done" })
    .run();
  for (const [id, name] of [
    ["f_checkout", "Checkout flow"],
    ["f_loan", "Loan simple mode"],
  ] as const) {
    db.insert(schema.features)
      .values({ id, projectId: "p1", name, branch: `feature/${id}` })
      .run();
  }
});

after(() => rmSync(root, { recursive: true, force: true }));

const project = () => ({ id: "p1", path: projectDir });
const bySource = (sourcePath: string) =>
  db
    .select()
    .from(schema.testScenarios)
    .where(eq(schema.testScenarios.sourcePath, sourcePath))
    .get();

/* ------------------------------------------------------------------ scanning */

test("scans every agent's scenario folder and records which one it came from", () => {
  const scan = ts.scanTestScenarios(projectDir);
  const paths = scan.scenarios.map((s) => s.sourcePath).sort();
  assert.deepEqual(paths, [
    `${FE_DIR}/loan-simple-mode.md`,
    `${QA_DIR}/checkout.md`,
    `${QA_DIR}/planned-later.md`,
    `${SWE_DIR}/project-detail-overflow.md`,
  ]);
  const origins = Object.fromEntries(scan.scenarios.map((s) => [s.sourcePath, s.origin]));
  assert.equal(origins[`${QA_DIR}/checkout.md`], "qa");
  assert.equal(origins[`${FE_DIR}/loan-simple-mode.md`], "fe");
  assert.equal(origins[`${SWE_DIR}/project-detail-overflow.md`], "swe");
});

test("refuses a symlink out of the project, and says it refused something", () => {
  const scan = ts.scanTestScenarios(projectDir);
  const bodies = scan.scenarios.map((s) => s.body).join("\n");
  assert.ok(!bodies.includes(SECRET), "a symlinked file's contents reached a scenario");
  assert.ok(!scan.scenarios.some((s) => s.sourcePath.endsWith("sneaky.md")));
  // Non-markdown is skipped silently; a refused markdown file is counted, so "nothing
  // imported" can never be silent.
  assert.ok(scan.skipped >= 1, "the refused symlink was not reported");
});

test("titles come from the heading, with the template's prefix stripped", () => {
  const scan = ts.scanTestScenarios(projectDir);
  const titles = Object.fromEntries(scan.scenarios.map((s) => [s.sourcePath, s.title]));
  assert.equal(titles[`${QA_DIR}/checkout.md`], "Checkout happy path");
  assert.equal(
    titles[`${SWE_DIR}/project-detail-overflow.md`],
    "Project detail: no horizontal scroll",
  );
});

/* ------------------------------------------------------------------ grouping */

test("groups on the feature front matter when the file states one", () => {
  const id = ts.matchFeature(
    { sourcePath: `${QA_DIR}/checkout.md`, featureHint: "Checkout flow" },
    [{ id: "f_checkout", name: "Checkout flow" }],
  );
  assert.equal(id, "f_checkout");
});

test("infers a feature from the filename when the file states none", () => {
  // Every scenario the fe/swe agents have already written is this case — they predate the
  // front-matter key entirely, so the filename is all there is.
  const id = ts.matchFeature(
    { sourcePath: `${FE_DIR}/loan-simple-mode.md`, featureHint: null },
    [{ id: "f_loan", name: "Loan simple mode" }],
  );
  assert.equal(id, "f_loan");
});

test("a stated feature that does not exist stays ungrouped rather than being guessed at", () => {
  const id = ts.matchFeature(
    { sourcePath: `${FE_DIR}/loan-simple-mode.md`, featureHint: "Not Yet Created" },
    [{ id: "f_loan", name: "Loan simple mode" }],
  );
  assert.equal(id, null, "an explicit hint must not fall through to filename guessing");
});

test("an ambiguous filename match resolves to ungrouped, not a coin flip", () => {
  const id = ts.matchFeature({ sourcePath: `${FE_DIR}/checkout-flow.md`, featureHint: null }, [
    { id: "a", name: "Checkout" },
    { id: "b", name: "Checkout" },
  ]);
  assert.equal(id, null);
});

test("a short feature name cannot capture unrelated scenarios", () => {
  const id = ts.matchFeature({ sourcePath: `${FE_DIR}/ui-overflow-fix.md`, featureHint: null }, [
    { id: "f_ui", name: "UI" },
  ]);
  assert.equal(id, null, "a 2-character feature slug matched by containment");
});

test("containment only counts at a dash boundary", () => {
  const inside = ts.matchFeature({ sourcePath: `${FE_DIR}/precheckouts.md`, featureHint: null }, [
    { id: "f_checkout", name: "checkout" },
  ]);
  assert.equal(inside, null, "matched a feature slug in the middle of a word");

  const boundary = ts.matchFeature(
    { sourcePath: `${FE_DIR}/checkout-empty-cart.md`, featureHint: null },
    [{ id: "f_checkout", name: "checkout" }],
  );
  assert.equal(boundary, "f_checkout");
});

test("a shared leading run of tokens groups a scenario under a sentence-named feature", () => {
  // The shape real data has: features derived from a `.pm/tasks/` request folder are named
  // after the request, so they read as a sentence, while the scenario beside one is a short
  // slug. Neither contains the other.
  const id = ts.matchFeature(
    { sourcePath: `${FE_DIR}/feature-grouping-ui.md`, featureHint: null },
    [
      {
        id: "f_grouping",
        name: "Feature grouping, feature branches, and parallel runs from the backlog",
      },
      { id: "f_auth", name: "Authentication & per-user Anthropic tokens" },
    ],
  );
  assert.equal(id, "f_grouping");
});

test("one shared token is a coincidence, not a match", () => {
  // "usage" alone is the word half this project's features start with. Requiring two whole
  // tokens AND ten characters is what stops the prefix tier degenerating into that.
  assert.equal(
    ts.matchFeature({ sourcePath: `${FE_DIR}/usage.md`, featureHint: null }, [
      { id: "f_a", name: "Usage page: per-task project, date-range filter" },
      { id: "f_b", name: "Usage: own nav menu instead of Settings" },
    ]),
    null,
  );
  // Two tokens is a subject, and the more specific of the two features wins.
  assert.equal(
    ts.matchFeature({ sourcePath: `${FE_DIR}/usage-page-filters.md`, featureHint: null }, [
      { id: "f_a", name: "Usage page: per-task project, date-range filter" },
      { id: "f_b", name: "Usage: own nav menu instead of Settings" },
    ]),
    "f_a",
  );
});

test("two tokens that are too short do not match", () => {
  // `MIN_PREFIX_TOKENS` and `MIN_PREFIX_CHARS` are both required: two tokens can be "a-b".
  assert.equal(
    ts.matchFeature({ sourcePath: `${FE_DIR}/up-to-date-badge.md`, featureHint: null }, [
      { id: "f_x", name: "Up to something else entirely" },
    ]),
    null,
  );
});

test("unrelated work stays ungrouped rather than being filed somewhere wrong", () => {
  assert.equal(
    ts.matchFeature({ sourcePath: `${SWE_DIR}/git-hook-neutralization.md`, featureHint: null }, [
      { id: "f_hooks", name: "Neutralize shared git hooks/config across task worktrees" },
    ]),
    null,
    "a semantic-only relationship was guessed at lexically",
  );
});

/* ---------------------------------------------------------------- syncing */

test("sync imports the scan and is idempotent", () => {
  const first = ts.syncProjectTestScenarios(project());
  assert.equal(first.added, 4);

  const second = ts.syncProjectTestScenarios(project());
  assert.equal(second.added, 0, "a second sync added rows");
  assert.equal(second.updated, 0, "a second sync rewrote unchanged rows");

  assert.equal(
    db.select().from(schema.testScenarios).all().length,
    4,
    "duplicate rows after two syncs",
  );
});

test("grouping is applied on import, including the inferred kind", () => {
  assert.equal(bySource(`${QA_DIR}/checkout.md`)?.featureId, "f_checkout");
  assert.equal(bySource(`${FE_DIR}/loan-simple-mode.md`)?.featureId, "f_loan");
  assert.equal(bySource(`${SWE_DIR}/project-detail-overflow.md`)?.featureId, null);
});

test("a hint naming a feature that appears later regroups for free", () => {
  const row = bySource(`${QA_DIR}/planned-later.md`);
  assert.equal(row?.featureId, null);
  assert.equal(row?.featureHint, "Not Yet Created", "the stated feature was not kept");

  db.insert(schema.features)
    .values({ id: "f_later", projectId: "p1", name: "Not Yet Created", branch: "feature/later" })
    .run();

  assert.equal(ts.regroupOrphanedScenarios("p1"), 1);
  assert.equal(bySource(`${QA_DIR}/planned-later.md`)?.featureId, "f_later");
});

test("an edited scenario refreshes its content but never its status", () => {
  const before = bySource(`${SWE_DIR}/project-detail-overflow.md`);
  assert.ok(before);
  ts.setScenarioStatus(project(), before, { status: "closed", manual: true });

  write(SWE_DIR, "project-detail-overflow.md", plain("Project detail: renamed"));
  ts.syncProjectTestScenarios(project());

  const after = bySource(`${SWE_DIR}/project-detail-overflow.md`);
  // The row is archived, so the sync leaves it entirely alone — a file reappearing at a
  // closed scenario's path is a new scenario sharing a name, not the closed one returning.
  assert.equal(after?.status, "closed", "a sync reopened a closed scenario");
});

/* ------------------------------------------------------- archive / restore */

test("closing archives the markdown, and reopening puts it back", () => {
  const row = bySource(`${FE_DIR}/loan-simple-mode.md`);
  assert.ok(row);
  const live = resolve(projectDir, `${FE_DIR}/loan-simple-mode.md`);
  const archived = resolve(projectDir, ts.archivePathFor(`${FE_DIR}/loan-simple-mode.md`));
  assert.ok(existsSync(live));

  const closed = ts.setScenarioStatus(project(), row, { status: "closed", manual: true });
  assert.equal(closed.file, "moved");
  assert.equal(existsSync(live), false, "the markdown stayed in the working tree");
  assert.ok(existsSync(archived), "the markdown did not reach the archive");
  assert.equal(closed.scenario.archivedPath, `.qa/archive/${FE_DIR}/loan-simple-mode.md`);

  const reopened = ts.setScenarioStatus(project(), closed.scenario, {
    status: "open",
    manual: true,
  });
  assert.equal(reopened.file, "moved");
  assert.ok(existsSync(live), "reopening did not restore the markdown");
  assert.equal(reopened.scenario.archivedPath, null);
});

test("the archive is never walked, so a closed scenario does not come back", () => {
  const row = bySource(`${FE_DIR}/loan-simple-mode.md`);
  assert.ok(row);
  ts.setScenarioStatus(project(), row, { status: "closed", manual: true });

  const scan = ts.scanTestScenarios(projectDir);
  assert.ok(
    !scan.scenarios.some((s) => s.sourcePath.includes(".qa/archive")),
    "the scan walked the archive",
  );
  // Put it back for the specs that follow.
  ts.setScenarioStatus(project(), bySource(`${FE_DIR}/loan-simple-mode.md`)!, {
    status: "open",
    manual: true,
  });
});

test("a move that would leave the project is refused", () => {
  assert.equal(ts.moveScenarioFile(projectDir, "../outside-secret.txt", "x.md"), "refused");
  assert.equal(
    ts.moveScenarioFile(projectDir, `${FE_DIR}/loan-simple-mode.md`, "../escaped.md"),
    "refused",
  );
  assert.ok(existsSync(outsideSecret), "a refused move still touched the file");
});

test("a status change survives its markdown already being gone", () => {
  // Closing must not be blocked by a file someone deleted by hand — the row is what the list
  // renders, and a scenario that cannot be closed would be stuck open forever.
  const missing = ts.moveScenarioFile(projectDir, `${QA_DIR}/never-existed.md`, "x.md");
  assert.equal(missing, "missing");
});

/* ------------------------------------------------------------- run results */

test("a run with failures leaves the scenario open", () => {
  const row = bySource(`${QA_DIR}/checkout.md`);
  assert.ok(row);
  const result = ts.recordScenarioRun(project(), row, { taskId: "t1", passed: 4, failed: 2 });
  assert.equal(result.scenario.status, "open");
  assert.equal(result.scenario.lastPassed, 4);
  assert.equal(result.scenario.lastFailed, 2);
  assert.equal(result.scenario.lastTaskId, "t1");
});

test("a run that passed every step completes the scenario and archives it", () => {
  const row = bySource(`${QA_DIR}/checkout.md`);
  assert.ok(row);
  const result = ts.recordScenarioRun(project(), row, { taskId: "t1", passed: 6, failed: 0 });
  assert.equal(result.scenario.status, "passed");
  assert.equal(result.file, "moved");
  assert.equal(existsSync(resolve(projectDir, `${QA_DIR}/checkout.md`)), false);
});

test("a run that exercised nothing is not a pass", () => {
  // The case that matters: a QA session that crashed before step one, or an agent calling the
  // tool to tidy up. Zero failures is not the same statement as "it works".
  write(QA_DIR, "empty-run.md", plain("Nothing ran"));
  ts.syncProjectTestScenarios(project());
  const row = bySource(`${QA_DIR}/empty-run.md`);
  assert.ok(row);
  const result = ts.recordScenarioRun(project(), row, { taskId: "t1", passed: 0, failed: 0 });
  assert.equal(result.scenario.status, "open");
});

test("a status set by hand outranks a later passing run", () => {
  write(QA_DIR, "pinned.md", plain("Pinned by a person"));
  ts.syncProjectTestScenarios(project());
  const row = bySource(`${QA_DIR}/pinned.md`);
  assert.ok(row);

  const closed = ts.setScenarioStatus(project(), row, { status: "closed", manual: true });
  assert.equal(closed.scenario.statusOverride, true);

  const run = ts.recordScenarioRun(project(), closed.scenario, {
    taskId: "t1",
    passed: 9,
    failed: 0,
  });
  assert.equal(run.pinned, true, "an automatic run overrode a manual status");
  assert.equal(run.scenario.status, "closed");
});

/* ------------------------------------------------------------ bulk + refs */

test("closing a group moves only its open scenarios", () => {
  write(QA_DIR, "group-a.md", withFeature("Checkout flow", "Group A"));
  write(QA_DIR, "group-b.md", withFeature("Checkout flow", "Group B"));
  ts.syncProjectTestScenarios(project());

  const before = ts
    .listTestScenarios("p1")
    .filter((s) => s.featureId === "f_checkout" && s.status === "open").length;
  assert.ok(before >= 2);

  const closed = ts.closeScenarioGroup(project(), "f_checkout");
  assert.equal(closed.length, before);
  assert.ok(closed.every((s) => s.status === "closed"));

  // The already-passed checkout scenario keeps its outcome rather than being re-closed.
  assert.equal(bySource(`${QA_DIR}/checkout.md`)?.status, "passed");
});

test("a scenario reference that matches two scenarios resolves to neither", () => {
  write(FE_DIR, "shared-name.md", plain("Shared name"));
  write(SWE_DIR, "shared-name.md", plain("Shared name"));
  ts.syncProjectTestScenarios(project());

  assert.equal(ts.resolveScenarioRef("p1", "shared-name.md"), null, "an ambiguous ref matched");
  // The full path is never ambiguous.
  assert.equal(
    ts.resolveScenarioRef("p1", `${FE_DIR}/shared-name.md`)?.sourcePath,
    `${FE_DIR}/shared-name.md`,
  );
});

test("grouping for display puts Ungrouped last and counts each status", () => {
  const groups = ts.groupScenarios(ts.listTestScenarios("p1"), [
    { id: "f_checkout", name: "Checkout flow" },
    { id: "f_loan", name: "Loan simple mode" },
  ]);
  assert.equal(groups.at(-1)?.featureId, null);
  assert.equal(groups.at(-1)?.featureName, "Ungrouped");

  const checkout = groups.find((g) => g.featureId === "f_checkout");
  assert.ok(checkout);
  assert.equal(
    checkout.openCount + checkout.passedCount + checkout.closedCount,
    checkout.scenarios.length,
  );
});

test("a scenario from another project never appears in this one's list", () => {
  db.insert(schema.projects)
    .values({ id: "p2", name: "P2", path: join(root, "other") })
    .run();
  db.insert(schema.testScenarios)
    .values({
      id: "ts_other",
      projectId: "p2",
      title: "Someone else's",
      sourcePath: `${QA_DIR}/checkout.md`,
      origin: "qa",
    })
    .run();

  assert.ok(!ts.listTestScenarios("p1").some((s) => s.id === "ts_other"));
  assert.equal(ts.findTestScenario("p1", "ts_other"), null, "cross-project id was readable");
});
