/**
 * The once-per-version remediation pass.
 *
 * The contract worth protecting is what it *doesn't* do: it must not touch an un-onboarded
 * project, must not rebuild a graph that already exists, must not run twice for the same
 * version, and must not be able to take the runner down. Each of those is a real cost or a
 * real risk on someone else's machine, not a hypothetical.
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-post-update-test-"));
// Set before lib/config loads: DATA_DIR is resolved at module load.
process.env.PLATFORM_DATA_DIR = join(root, "data");
process.env.PLATFORM_DB = join(root, "test.db");
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

// Imported in `before`, not at the top: the module reads DATA_DIR through lib/config, which
// resolves it at load, so the env above has to be in place first. (Top-level await is not
// available here — the test runner transforms to CJS.)
type Mod = typeof import("./post-update");
let isNewVersion: Mod["isNewVersion"];
let readVersionStamp: Mod["readVersionStamp"];
let runPostUpdateChores: Mod["runPostUpdateChores"];
let writeVersionStamp: Mod["writeVersionStamp"];

before(async () => {
  ({ isNewVersion, readVersionStamp, runPostUpdateChores, writeVersionStamp } = await import(
    "./post-update"
  ));
});

let seq = 0;
function project(files: Record<string, number | string>) {
  const dir = join(root, `p${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [rel, spec] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof spec === "number" ? "x".repeat(spec) : spec);
  }
  return { id: `id${seq}`, name: `proj${seq}`, path: dir, isWorkspace: false, members: [] };
}

test("the version stamp round-trips, and a missing one reads as null", () => {
  assert.equal(readVersionStamp(join(root, "no-such-dir")), null);

  const dir = join(root, "stamped");
  writeVersionStamp("0.11.1", dir);
  assert.equal(readVersionStamp(dir), "0.11.1");

  writeVersionStamp("0.12.0", dir);
  assert.equal(readVersionStamp(dir), "0.12.0");
});

test("a version change is detected; the same version is not", () => {
  // The whole pass hangs off this: getting it wrong either re-scans every boot or never runs.
  assert.equal(isNewVersion("0.12.0", "0.11.1"), true);
  assert.equal(isNewVersion("0.11.1", "0.11.1"), false);
  assert.equal(isNewVersion("0.11.1", null), true); // first boot after the stamp existed
});

test("an unwritable stamp directory is survived rather than thrown", () => {
  // A read-only or bogus data dir must not stop the runner booting; the pass just re-runs
  // next time. Modelled as a directory path whose parent is a regular file (ENOTDIR) — a
  // portable, instant failure. (Not a path under /proc: writes there *block* rather than
  // failing, which hangs the test process rather than exercising the catch.)
  const blocker = join(root, "not-a-dir");
  writeFileSync(blocker, "x");
  const target = join(blocker, "nested");

  writeVersionStamp("0.12.0", target);
  assert.equal(readVersionStamp(target), null);
});

test("an un-onboarded project is skipped entirely — no graph, no finding", async () => {
  // It gets both the moment it is onboarded, so spending minutes here would be pure waste.
  const rows = [project({ "README.md": 10 })];
  const summary = await runPostUpdateChores({ rows, log: () => {} });

  assert.deepEqual(summary.built, []);
  assert.deepEqual(summary.needsAttention, []);
});

test("a healthy onboarded project produces no work and no noise", async () => {
  const rows = [project({ "CLAUDE.md": 5_000, "graphify-out/graph.json": "{}" })];
  const summary = await runPostUpdateChores({ rows, log: () => {} });

  assert.deepEqual(summary.built, []);
  assert.deepEqual(summary.needsAttention, []);
});

test("an oversize CLAUDE.md is reported for the user, never rewritten", async () => {
  const row = project({ "CLAUDE.md": 147_000, "graphify-out/graph.json": "{}" });
  const before = readFileSizeOf(row.path, "CLAUDE.md");
  const summary = await runPostUpdateChores({ rows: [row], log: () => {} });

  assert.equal(summary.needsAttention.length, 1);
  assert.match(summary.needsAttention[0].summary, /every API call/);
  // The file is the user's. Measuring it must never change it.
  assert.equal(readFileSizeOf(row.path, "CLAUDE.md"), before);
});

test("one broken project does not stop the sweep", async () => {
  const rows = [
    { id: "gone", name: "gone", path: join(root, "vanished"), isWorkspace: false, members: [] },
    project({ "CLAUDE.md": 147_000, "graphify-out/graph.json": "{}" }),
  ];
  const summary = await runPostUpdateChores({ rows, log: () => {} });

  assert.equal(summary.needsAttention.length, 1, "the healthy-path project still got scanned");
});

function readFileSizeOf(dir: string, rel: string): number {
  return statSync(join(dir, rel)).size;
}
