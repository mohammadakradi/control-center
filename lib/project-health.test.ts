/**
 * Measuring what an already-onboarded project costs per run.
 *
 * Against real files on disk, because the whole module is `statSync` against a documented
 * budget — stubbing the filesystem would test the stub. The budgets themselves are asserted
 * against the numbers the agent rules state, so the two can't drift silently apart.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOC_BUDGETS,
  NOTE_BUDGET,
  compareVersions,
  estimateTokens,
  healthSummary,
  scanProjectHealth,
} from "./project-health";

const root = mkdtempSync(join(tmpdir(), "platform-health-test-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** A project directory containing `files` (relative path → byte size or literal content). */
function project(files: Record<string, number | string>): string {
  const dir = join(root, `p${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [rel, spec] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof spec === "number" ? "x".repeat(spec) : spec);
  }
  return dir;
}

test("a project inside every budget, with a graph, reports nothing", () => {
  const dir = project({
    "CLAUDE.md": 5_000,
    ".swe/notes.md": 2_000,
    ".swe/notes/environment.md": 4_000,
    "graphify-out/graph.json": "{}",
  });
  const health = scanProjectHealth(dir);

  assert.equal(health.onboarded, true);
  assert.equal(health.hasGraph, true);
  assert.deepEqual(health.findings, []);
  assert.equal(healthSummary(health), null);
});

test("an oversize CLAUDE.md is reported with what it costs on every call", () => {
  // The real shape of the problem: 147 KB, measured on this install before it was found.
  const dir = project({ "CLAUDE.md": 147_000, "graphify-out/graph.json": "{}" });
  const health = scanProjectHealth(dir);

  const finding = health.findings.find((f) => f.subject === "CLAUDE.md");
  assert.ok(finding, "CLAUDE.md must be flagged");
  assert.equal(finding.kind, "oversize-doc");
  assert.equal(finding.budget, DOC_BUDGETS["CLAUDE.md"]);
  // ~4 bytes/token is the ratio the agent rules quote ("at 150 KB it is ~38k tokens").
  assert.equal(finding.tokensPerCall, estimateTokens(147_000));
  assert.ok(finding.tokensPerCall! > 36_000 && finding.tokensPerCall! < 38_000);
  assert.equal(health.tokensPerCall, finding.tokensPerCall);
  assert.match(healthSummary(health)!, /every API call/);
});

test("CLAUDE.md counts toward per-call cost even when it is inside budget", () => {
  // The headline number is what the project *costs*, not only what it overspends by.
  const dir = project({ "CLAUDE.md": 8_000, "graphify-out/graph.json": "{}" });
  const health = scanProjectHealth(dir);

  assert.equal(health.tokensPerCall, estimateTokens(8_000));
  assert.deepEqual(health.findings, []);
});

test("injected bloat outranks a read-on-demand doc, which outranks a journal topic", () => {
  const dir = project({
    "CLAUDE.md": 40_000,
    ".fe/design-system.md": 60_000,
    ".swe/notes/decisions.md": NOTE_BUDGET + 1_000,
    "graphify-out/graph.json": "{}",
  });
  const health = scanProjectHealth(dir);

  assert.deepEqual(
    health.findings.map((f) => f.subject),
    ["CLAUDE.md", ".fe/design-system.md", ".swe/notes/decisions.md"],
  );
});

test("an onboarded project with no graph is flagged; an un-onboarded one is not", () => {
  const onboarded = project({ "CLAUDE.md": 5_000 });
  assert.ok(
    scanProjectHealth(onboarded).findings.some((f) => f.kind === "missing-graph"),
    "an onboarded project with no graph needs one",
  );

  // Nothing to remediate: onboarding writes correct documents and builds the graph itself.
  const fresh = project({ "README.md": 100 });
  const health = scanProjectHealth(fresh);
  assert.equal(health.onboarded, false);
  assert.deepEqual(health.findings, []);
});

test("journal topics are only flagged past their own 30 KB budget", () => {
  const dir = project({
    "CLAUDE.md": 5_000,
    "graphify-out/graph.json": "{}",
    ".swe/notes/small.md": NOTE_BUDGET - 1,
    ".swe/notes/big.md": NOTE_BUDGET + 1,
    // Not markdown — the journal budget is about documents, not whatever else lands there.
    ".swe/notes/data.json": NOTE_BUDGET * 3,
  });
  const subjects = scanProjectHealth(dir).findings.map((f) => f.subject);

  assert.deepEqual(subjects, [".swe/notes/big.md"]);
});

test("a CLI-installed plugin older than the bundled one is flagged, newer or equal is not", () => {
  const dir = project({ "CLAUDE.md": 5_000, "graphify-out/graph.json": "{}" });
  const bundledVersions = { swe: "0.9.0", fe: "0.5.0", pm: "0.6.0" };

  const stale = scanProjectHealth(dir, {
    bundledVersions,
    installedVersions: {
      swe: { version: "0.8.0", fromCli: true }, // behind — app updates never reach it
      fe: { version: "0.5.0", fromCli: true }, // level
      pm: { version: "0.4.0", fromCli: false }, // bundled, so it IS the shipped copy
    },
  });

  const flagged = stale.findings.filter((f) => f.kind === "stale-plugin").map((f) => f.subject);
  assert.deepEqual(flagged, ["swe"]);
  assert.match(stale.findings.find((f) => f.kind === "stale-plugin")!.detail, /0\.8\.0/);
});

test("the version check is skipped entirely when either side is unknown", () => {
  const dir = project({ "CLAUDE.md": 5_000, "graphify-out/graph.json": "{}" });

  // No maps at all.
  assert.deepEqual(scanProjectHealth(dir).findings, []);
  // A plugin that declares no version can't be compared — silence beats a guess.
  const health = scanProjectHealth(dir, {
    bundledVersions: { swe: "0.9.0" },
    installedVersions: { swe: { version: null, fromCli: true } },
  });
  assert.deepEqual(health.findings, []);
});

test("compareVersions orders by segment and survives junk", () => {
  assert.equal(compareVersions("0.8.0", "0.9.0"), -1);
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1); // not string ordering
  assert.equal(compareVersions("1.0", "1.0.0"), 0); // missing segments are 0
  // A plugin.json can hold anything; a bad version must not throw mid-scan.
  assert.equal(compareVersions("beta", "beta"), 0);
  assert.equal(compareVersions("1.x", "1.0"), 0);
});

test("an unreadable project path reports nothing rather than throwing", () => {
  const health = scanProjectHealth(join(root, "does-not-exist"));
  assert.equal(health.onboarded, false);
  assert.deepEqual(health.findings, []);
});
