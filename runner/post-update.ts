import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../lib/db";
import { projects } from "../lib/db/schema";
import { DATA_DIR } from "../lib/config";
import { APP_VERSION } from "../lib/version";
import { scanProjectHealth } from "../lib/project-health";
import { ensureCodeGraph } from "./code-graph";

/**
 * Chores that run once, the first time the runner boots on a new version.
 *
 * An update swaps `~/.control-center/app/` and migrates the database. It does not — and must
 * not — touch a user's project folders, which is why everything the agents wrote under the old
 * rules survives an update unchanged. The result is that a user who updates gets better agent
 * *behaviour* and none of the savings that came from better agent *documents*.
 *
 * Only part of that gap can be closed automatically, and the division is not arbitrary:
 *
 *  - **A missing code graph is mechanical.** Building one is AST extraction with no model in
 *    the loop, it is idempotent, and the output is gitignored and regenerable. Nothing about
 *    it requires a judgment call, so it happens here without asking.
 *  - **An oversize `CLAUDE.md` is not.** Shrinking one means deciding what survives, which is
 *    the onboard skill's job. A script that truncated it would destroy the thing the file
 *    exists to carry. So it is measured and surfaced (`lib/project-health.ts`) and the user
 *    presses the button.
 *
 * Everything here is best-effort: it runs after the server is already listening, never blocks
 * boot, and a failure is logged and dropped.
 */

/** Where the last-booted version is remembered. In DATA_DIR, so it survives the app swap. */
export function versionStampPath(dataDir: string = DATA_DIR): string {
  return resolve(dataDir, "last-version");
}

export function readVersionStamp(dataDir?: string): string | null {
  try {
    const raw = readFileSync(versionStampPath(dataDir), "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function writeVersionStamp(version: string, dataDir?: string): void {
  try {
    mkdirSync(dataDir ?? DATA_DIR, { recursive: true });
    writeFileSync(versionStampPath(dataDir), `${version}\n`, "utf8");
  } catch {
    // An unwritable data dir means the chores re-run next boot. They are idempotent, so that
    // is a wasted scan rather than a problem — and it must not stop the runner serving.
  }
}

/**
 * Did the app change under us?
 *
 * A missing stamp is treated as "yes" *only* when there is something to act on — a fresh
 * install has no projects, so the first boot writes the stamp and does nothing. An install
 * that predates the stamp does have projects, and is exactly the case this exists for.
 */
export function isNewVersion(
  current: string,
  stamped: string | null,
): boolean {
  return stamped !== current;
}

export type BackfillSummary = {
  /** Projects whose graph this pass built. */
  built: string[];
  /** Projects left with findings a user has to act on. */
  needsAttention: { name: string; summary: string }[];
};

/**
 * Build code graphs for onboarded projects that have none, and report what is left over.
 *
 * Sequential and unbounded in time by design: it runs in the background behind a listening
 * server, and two `graphify extract` runs would just compete for the same disk. Each target
 * still carries the per-project ceiling from `CODE_GRAPH_TIMEOUT_MS`.
 */
export async function runPostUpdateChores(opts: {
  log?: (message: string) => void;
  /** Injected by the tests; defaults to reading the projects table. */
  rows?: { id: string; name: string; path: string; isWorkspace: boolean; members: { path: string; role?: string }[] }[];
} = {}): Promise<BackfillSummary> {
  const log = opts.log ?? ((m: string) => console.log(`[runner] ${m}`));
  const rows =
    opts.rows ??
    db
      .select({
        id: projects.id,
        name: projects.name,
        path: projects.path,
        isWorkspace: projects.isWorkspace,
        members: projects.members,
      })
      .from(projects)
      .all();

  const summary: BackfillSummary = { built: [], needsAttention: [] };

  for (const row of rows) {
    let health;
    try {
      health = scanProjectHealth(row.path);
    } catch {
      continue; // an unreadable project (unplugged drive, deleted folder) is not our problem
    }
    // Never onboarded → nothing has been written under the old rules, and onboarding will
    // build the graph itself. Skipping keeps this pass to the installs it can actually help.
    if (!health.onboarded) continue;

    if (!health.hasGraph) {
      try {
        const results = await ensureCodeGraph({
          project: { path: row.path, isWorkspace: row.isWorkspace, members: row.members },
          env: process.env,
          onLog: (m) => log(`[graph:${row.name}] ${m}`),
          onlyMissing: true,
        });
        if (results.some((r) => r.outcome === "built")) summary.built.push(row.name);
      } catch {
        // ensureCodeGraph is already fail-soft; this is belt and braces so one project can
        // never stop the sweep.
      }
    }

    // Re-scan: the graph we just built should not still be reported as missing.
    try {
      const after = scanProjectHealth(row.path);
      const remaining = after.findings.filter((f) => f.kind !== "missing-graph" || !after.hasGraph);
      if (remaining.length) {
        const worst = remaining[0];
        summary.needsAttention.push({ name: row.name, summary: worst.detail });
      }
    } catch {
      /* best-effort */
    }
  }

  return summary;
}

/**
 * The boot entry point. Returns immediately; the work continues in the background.
 *
 * The stamp is written *before* the chores run, not after: a graph build that crashes the
 * process should not make every subsequent boot retry it forever. The pass is a courtesy, not
 * a guarantee, and the user can always re-onboard.
 */
export function schedulePostUpdateChores(
  log: (message: string) => void = (m) => console.log(`[runner] ${m}`),
): void {
  const stamped = readVersionStamp();
  if (!isNewVersion(APP_VERSION, stamped)) return;
  writeVersionStamp(APP_VERSION);

  // A first-ever boot has nothing to remediate and should say nothing.
  if (stamped === null) return;

  log(`updated ${stamped} → ${APP_VERSION}; checking projects for missing code graphs…`);
  void runPostUpdateChores({ log })
    .then((s) => {
      if (s.built.length) log(`built code graphs for: ${s.built.join(", ")}`);
      for (const p of s.needsAttention) {
        log(`${p.name} still needs attention — ${p.summary}`);
      }
      if (!s.built.length && !s.needsAttention.length) {
        log("all projects are within budget and have a code graph.");
      }
    })
    .catch(() => {
      /* never let a background chore take the runner down */
    });
}
