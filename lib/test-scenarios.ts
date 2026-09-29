/**
 * Test scenarios — the manual verification steps the agents already write, made into something
 * anyone goes back to.
 *
 * Every `/fe:task` and `/swe:task` ends by writing a scenario to `.fe/test-scenarios/` or
 * `.swe/test-scenarios/` (their rule 14), and `/qa:scenario` writes to `.qa/scenarios/`. Until
 * now that was the end of it: markdown in a folder, never listed, never closed out, no record of
 * whether anyone ran it. This module scans those folders into rows so the platform can show
 * what is still unverified, grouped by the feature it belongs to.
 *
 * The split with `lib/backlog.ts` is deliberate, not accidental duplication: a backlog item is
 * work to *do* and a scenario is work to *check*, and they have different lifecycles (a scenario
 * can pass, which nothing in the backlog can). What they share — the hardened file read, the
 * caps, "disk owns content, rows own status" — is imported from there rather than copied.
 *
 * As in `lib/backlog.ts`, every rule, bound and validator lives here where `pnpm test` can reach
 * it; the API routes only translate HTTP.
 */
import { type Dirent, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  features,
  testScenarios,
  type Feature,
  type Project,
  type TestScenario,
  type TestScenarioOrigin,
  type TestScenarioStatus,
} from "./db/schema";
// The hardened single-file read (O_NOFOLLOW, one hard link, regular files only, bounded by the
// size fstat reported) and its byte budget. A scenario is read on an unauthenticated GET from a
// folder an agent writes into, which is exactly the threat model that function was written for.
import { readSpecFile } from "./backlog";
import { featureSlug } from "./features";
import { parseFrontmatter } from "./frontmatter";
import { isInside, isUsableRelPath } from "./safe-read";
import { newId } from "./util";

/** Where each agent leaves its scenarios, project-relative. Order is the listing order for
 *  scenarios that share everything else, so the qa agent's own come first. */
export const SCENARIO_DIRS: readonly { dir: string; origin: TestScenarioOrigin }[] = [
  { dir: ".qa/scenarios", origin: "qa" },
  { dir: ".fe/test-scenarios", origin: "fe" },
  { dir: ".swe/test-scenarios", origin: "swe" },
];

/**
 * Where a scenario's markdown is moved when it leaves `open`.
 *
 * One archive for every origin rather than one beside each source folder, and the original
 * project-relative path is preserved underneath it — so `.fe/test-scenarios/checkout.md`
 * becomes `.qa/archive/.fe/test-scenarios/checkout.md`. That keeps the move reversible by
 * construction (reopening is the same rename backwards) and keeps provenance readable without
 * consulting the database.
 */
export const ARCHIVE_DIR = ".qa/archive";

/**
 * Bounds on one scan. Same reasoning as the backlog's, and they must stay in the same order of
 * magnitude: this runs synchronously on an unauthenticated GET in the process that also serves
 * the live task streams, so a repo with a pathological folder must not decide how much work
 * that request does. A real project has a few dozen scenarios of a few kB.
 */
const MAX_SCENARIOS = 300;
const MAX_SCAN_BYTES = 4 * 1024 * 1024;
/** Entries considered per scenario folder, so one enormous directory can't dominate. */
const MAX_DIR_ENTRIES = 500;

/** Caps on API-supplied text — the DB has no opinion, and every scenario's title is rendered
 *  in a list while its body is returned in full. */
export const MAX_SCENARIO_TITLE_LENGTH = 200;

export const TEST_SCENARIO_STATUSES: readonly TestScenarioStatus[] = [
  "open",
  "passed",
  "closed",
];

export function isTestScenarioStatus(v: unknown): v is TestScenarioStatus {
  return TEST_SCENARIO_STATUSES.includes(v as TestScenarioStatus);
}

/** The two statuses that take a scenario out of the open list, and so archive its file. */
const TERMINAL_STATUSES: readonly TestScenarioStatus[] = ["passed", "closed"];
export const isTerminalScenarioStatus = (s: TestScenarioStatus) =>
  TERMINAL_STATUSES.includes(s);

const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);
/** A control character in a name is never legitimate here, and a newline in a `sourcePath`
 *  would let it forge a line in the preamble a dispatched run is handed. */
const hasControlChars = (name: string) => /[\x00-\x1f\x7f]/.test(name);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** One scenario file as found on disk. */
export type ScannedScenario = {
  /** Project-relative, `/`-separated. The sync key. */
  sourcePath: string;
  origin: TestScenarioOrigin;
  title: string;
  /** The file, verbatim — it is what a run is handed. */
  body: string;
  /** The `feature:` front-matter value, cleaned. Null when the file didn't state one. */
  featureHint: string | null;
};

export type ScenarioScan = {
  scenarios: ScannedScenario[];
  /** Entries the scan refused or couldn't read (symlinks, hard links, oversized, special
   *  files, unreadable folders). Reported so "nothing imported" is never silent. */
  skipped: number;
  /** A cap stopped the walk, so some scenarios on disk are not represented. */
  truncated: boolean;
};

/**
 * The scenario's name.
 *
 * Preference order is "what the file says about itself", narrowing to the filename: the
 * `# Test scenario: <name>` heading the agents' own template writes, then any first-level
 * heading, then a `feature:` front-matter value, then the filename made readable. The heading
 * wins over front matter because the heading names *this scenario* while `feature:` names the
 * group it belongs to — several scenarios legitimately share the latter.
 */
export function scenarioTitle(content: string, fileName: string): string {
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const heading = stripped.match(/^#\s+(.+?)\s*$/m)?.[1];
  const fromHeading = heading?.replace(/^test\s+scenario\s*[:—-]\s*/i, "").trim();
  const fm = parseFrontmatter(content);
  const raw =
    fromHeading ||
    fm.feature ||
    fileName.replace(/\.(md|markdown)$/i, "").replace(/[-_]+/g, " ");
  const collapsed = raw.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  // Cut by code point, so a title ending in an emoji isn't truncated mid-surrogate-pair.
  const cut = [...collapsed].slice(0, MAX_SCENARIO_TITLE_LENGTH).join("").trim();
  return cut || fileName;
}

/** Read the scenario folders of a project. Directories that don't exist are the common case. */
export function scanTestScenarios(projectPath: string): ScenarioScan {
  const scenarios: ScannedScenario[] = [];
  let skipped = 0;
  let truncated = false;
  let scannedBytes = 0;

  for (const { dir, origin } of SCENARIO_DIRS) {
    const root = resolve(projectPath, dir);
    let entries: Dirent[];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue; // no such folder — the common case for a project that uses one agent
    }
    if (entries.length > MAX_DIR_ENTRIES) truncated = true;

    // Newest-looking last: names are slugs, not timestamps, so sort by name and let the caps
    // shed alphabetically-late files rather than pretending to know recency.
    for (const file of entries.sort(byName).slice(0, MAX_DIR_ENTRIES)) {
      if (!isMarkdown(file.name)) continue;
      if (!file.isFile() || hasControlChars(file.name)) {
        skipped += 1;
        continue;
      }
      if (scenarios.length >= MAX_SCENARIOS || scannedBytes >= MAX_SCAN_BYTES) {
        truncated = true;
        break;
      }
      const content = readSpecFile(resolve(root, file.name));
      if (content === null) {
        skipped += 1;
        continue;
      }
      scannedBytes += content.length;
      const fm = parseFrontmatter(content);
      const hint = (fm.feature ?? "").replace(/\s+/g, " ").trim();
      scenarios.push({
        sourcePath: `${dir}/${file.name}`,
        origin,
        title: scenarioTitle(content, file.name),
        body: content,
        featureHint: hint || null,
      });
    }
  }
  return { scenarios, skipped, truncated };
}

/**
 * Which feature a scenario belongs to, as a pure function of its stated hint, its own slug, and
 * the project's features. Null means Ungrouped, which is an honest answer and the default.
 *
 * Two ways to match, in strict precedence:
 *
 *  1. **The file said so.** A `feature:` front-matter value matched against feature names and
 *     slugs. `/qa:scenario` writes this key, so a scenario authored by the qa agent groups
 *     exactly where it says it does.
 *  2. **The slug lines up.** Scenarios written by the fe/swe agents carry no front matter — they
 *     predate this entirely — so the filename is all there is. `loan-simple-mode.md` under a
 *     feature named "Loan simple mode" is the same work by any reading.
 *
 * Slug matching is deliberately narrow, in three tiers of decreasing confidence:
 *
 *  - **Equality.** `loan-simple-mode.md` under "Loan simple mode".
 *  - **Containment at a dash boundary**, so `checkout` matches `checkout-empty-cart` but never
 *    `checkout` inside `precheckouts`.
 *  - **A shared leading run of whole tokens.** This is the tier real data needs: a feature
 *    derived from a `.pm/tasks/` request folder is named after the request, so it reads as a
 *    sentence — "Feature grouping, feature branches, and parallel runs from the backlog" —
 *    while the scenario beside it is called `feature-grouping-ui.md`. Neither contains the
 *    other, yet they are plainly the same work. Requiring `MIN_PREFIX_TOKENS` **whole** tokens
 *    and `MIN_PREFIX_CHARS` characters is what keeps this from degenerating into "starts with
 *    the same letter": one shared token ("usage", "fix", "add") is a coincidence, two of ten
 *    characters or more is a subject.
 *
 * Features with a slug under `MIN_SLUG_MATCH` characters are excluded from every tier: a
 * feature called "UI" would otherwise capture half the project. And an ambiguous match — two
 * features equally specific — resolves to null rather than a coin flip, because a scenario
 * filed under the wrong feature is worse than one filed under none.
 */
const MIN_SLUG_MATCH = 4;
/** Whole dash-separated tokens a shared prefix must cover, and the characters it must span.
 *  Both, not either: two tokens can be `a-b`, and ten characters can be one long word. */
const MIN_PREFIX_TOKENS = 2;
const MIN_PREFIX_CHARS = 10;

/** How many leading dash-separated tokens two slugs share. */
function commonPrefix(a: string, b: string): { tokens: number; chars: number } {
  const at = a.split("-");
  const bt = b.split("-");
  let tokens = 0;
  while (tokens < at.length && tokens < bt.length && at[tokens] === bt[tokens]) tokens += 1;
  return { tokens, chars: at.slice(0, tokens).join("-").length };
}

export function matchFeature(
  scenario: Pick<ScannedScenario, "sourcePath" | "featureHint">,
  candidates: readonly Pick<Feature, "id" | "name">[],
): string | null {
  const norm = (s: string) => featureSlug(s);

  if (scenario.featureHint) {
    const hint = norm(scenario.featureHint);
    if (hint) {
      const exact = candidates.find((f) => norm(f.name) === hint);
      if (exact) return exact.id;
    }
    // The file named a feature that doesn't exist (yet). Don't fall through to slug guessing —
    // an explicit statement that didn't resolve is Ungrouped, and `featureHint` keeps it so the
    // grouping appears for free once someone creates that feature.
    return null;
  }

  const fileName = scenario.sourcePath.split("/").pop() ?? "";
  const slug = norm(fileName.replace(/\.(md|markdown)$/i, ""));
  if (slug.length < MIN_SLUG_MATCH) return null;

  const matches = candidates
    .map((f) => ({ f, s: norm(f.name), p: commonPrefix(norm(f.name), slug) }))
    .filter(({ s, p }) => {
      if (s.length < MIN_SLUG_MATCH) return false;
      if (s === slug) return true;
      // Containment, but only at a dash boundary in both directions.
      if (slug.startsWith(`${s}-`) || s.startsWith(`${slug}-`)) return true;
      return p.tokens >= MIN_PREFIX_TOKENS && p.chars >= MIN_PREFIX_CHARS;
    });
  if (matches.length === 0) return null;

  const exact = matches.find(({ s }) => s === slug);
  if (exact) return exact.f.id;

  // Most specific wins, measured one way for all three tiers: how many characters of shared
  // leading tokens the match rests on. That single number ranks containment above a bare
  // prefix for free (a contained slug shares *all* of the shorter side's tokens), and — the
  // part that matters — it makes a genuine tie look like one. Scoring a containment match by
  // the feature's own length instead would rank two features that both merely start with
  // "usage-" as different, and quietly file the scenario under the longer-named of them.
  const sorted = [...matches].sort((a, b) => b.p.chars - a.p.chars);
  if (sorted.length > 1 && sorted[0].p.chars === sorted[1].p.chars) return null;
  return sorted[0].f.id;
}

export type ScenarioSyncReport = {
  added: number;
  updated: number;
  skipped: number;
  truncated: boolean;
};

/**
 * Mirror a project's scenario folders into rows, idempotently.
 *
 * Content and grouping are refreshed from disk on every run; **status never is**. A scenario
 * that disappears from disk keeps its row — the row carries the status, the run history and the
 * archive location, none of which is recoverable from a deleted file.
 *
 * A row whose file is currently archived is skipped entirely rather than resurrected: its file
 * is under `.qa/archive/`, which the scan does not walk, so the only way it reappears at its
 * original path is someone putting it back — and that is what `setScenarioStatus(open)` does.
 */
export function syncProjectTestScenarios(
  project: Pick<Project, "id" | "path">,
): ScenarioSyncReport {
  const scan = scanTestScenarios(project.path);
  const report: ScenarioSyncReport = {
    added: 0,
    updated: 0,
    skipped: scan.skipped,
    truncated: scan.truncated,
  };
  if (scan.scenarios.length === 0) return report;

  const projectFeatures = db
    .select({ id: features.id, name: features.name })
    .from(features)
    .where(eq(features.projectId, project.id))
    .all();

  const existing = new Map(
    db
      .select()
      .from(testScenarios)
      .where(eq(testScenarios.projectId, project.id))
      .all()
      .map((r) => [r.sourcePath, r] as const),
  );

  for (const found of scan.scenarios) {
    const prior = existing.get(found.sourcePath);
    const featureId = matchFeature(found, projectFeatures);

    if (!prior) {
      db.insert(testScenarios)
        .values({
          id: newId("ts"),
          projectId: project.id,
          title: found.title,
          body: found.body,
          sourcePath: found.sourcePath,
          origin: found.origin,
          featureId,
          featureHint: found.featureHint,
        })
        .run();
      report.added += 1;
      continue;
    }

    // Its file is archived but something is at the original path again. That is a new scenario
    // sharing a name, not the archived one coming back — leave the row alone rather than
    // silently reopening work someone closed.
    if (prior.archivedPath) continue;

    const changed =
      prior.title !== found.title ||
      prior.body !== found.body ||
      prior.featureId !== featureId ||
      prior.featureHint !== found.featureHint ||
      prior.origin !== found.origin;
    if (!changed) continue;

    db.update(testScenarios)
      .set({
        title: found.title,
        body: found.body,
        origin: found.origin,
        featureId,
        featureHint: found.featureHint,
        updatedAt: new Date(),
      })
      .where(eq(testScenarios.id, prior.id))
      .run();
    report.updated += 1;
  }
  return report;
}

/* ------------------------------------------------------------------ reading */

export function listTestScenarios(projectId: string): TestScenario[] {
  return db
    .select()
    .from(testScenarios)
    .where(eq(testScenarios.projectId, projectId))
    .all();
}

/** Scoped to a project, so an id from another project reads as missing rather than as
 *  somebody else's row — the same shape `findBacklogItem` uses, and for the same reason. */
export function findTestScenario(projectId: string, id: string): TestScenario | null {
  return (
    db
      .select()
      .from(testScenarios)
      .where(and(eq(testScenarios.projectId, projectId), eq(testScenarios.id, id)))
      .get() ?? null
  );
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate a status change from the API. The only thing a client may change. */
export function parseScenarioStatusEdit(
  body: unknown,
): ParseResult<{ status: TestScenarioStatus }> {
  if (!body || typeof body !== "object") return { ok: false, error: "expected an object" };
  const status = (body as { status?: unknown }).status;
  if (!isTestScenarioStatus(status)) {
    return {
      ok: false,
      error: `status must be one of: ${TEST_SCENARIO_STATUSES.join(", ")}`,
    };
  }
  return { ok: true, value: { status } };
}

/** Validate the bulk close-a-group body. `featureId: null` is the Ungrouped bucket, and is a
 *  meaningful value here rather than a missing one — so it must be stated explicitly. */
export function parseGroupRef(body: unknown): ParseResult<{ featureId: string | null }> {
  if (!body || typeof body !== "object") return { ok: false, error: "expected an object" };
  const raw = (body as { featureId?: unknown }).featureId;
  if (raw === null) return { ok: true, value: { featureId: null } };
  if (typeof raw === "string" && raw.trim()) {
    return { ok: true, value: { featureId: raw.trim() } };
  }
  return {
    ok: false,
    error: "featureId must be a feature id, or null for the Ungrouped group",
  };
}

/** A feature's scenarios, as the UI renders them. `featureId: null` is the Ungrouped bucket. */
export type ScenarioGroup = {
  featureId: string | null;
  featureName: string;
  scenarios: TestScenario[];
  openCount: number;
  passedCount: number;
  closedCount: number;
};

/**
 * Group scenarios for display: features in name order, Ungrouped last.
 *
 * Pure so `pnpm test` can reach it — the grouping is the part with rules in it, and the
 * component that renders it must not be where they live.
 */
export function groupScenarios(
  scenarios: readonly TestScenario[],
  projectFeatures: readonly Pick<Feature, "id" | "name">[],
): ScenarioGroup[] {
  const nameById = new Map(projectFeatures.map((f) => [f.id, f.name] as const));
  const buckets = new Map<string | null, TestScenario[]>();
  for (const s of scenarios) {
    // A feature that was deleted leaves `featureId` null (ON DELETE SET NULL), so an unknown
    // id can only mean a cross-project row — treat it as ungrouped rather than inventing a name.
    const key = s.featureId && nameById.has(s.featureId) ? s.featureId : null;
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }

  const groups: ScenarioGroup[] = [];
  for (const [featureId, list] of buckets) {
    const sorted = [...list].sort(
      (a, b) => a.title.localeCompare(b.title) || a.sourcePath.localeCompare(b.sourcePath),
    );
    groups.push({
      featureId,
      featureName: featureId ? (nameById.get(featureId) as string) : "Ungrouped",
      scenarios: sorted,
      openCount: sorted.filter((s) => s.status === "open").length,
      passedCount: sorted.filter((s) => s.status === "passed").length,
      closedCount: sorted.filter((s) => s.status === "closed").length,
    });
  }
  return groups.sort((a, b) => {
    if (a.featureId === null) return 1; // Ungrouped last
    if (b.featureId === null) return -1;
    return a.featureName.localeCompare(b.featureName);
  });
}

/* ------------------------------------------------------- archiving the file */

export type ArchiveOutcome = "moved" | "missing" | "refused";

/**
 * Move a scenario's markdown between its source location and the archive.
 *
 * This is the one place the platform **writes** into a project folder, so it is the one place
 * that has to prove where it is writing. Both ends are checked with `isInside` against the
 * realpath'd project root — not the spelling of the path — because `sourcePath` reaches here
 * from a row that a scan wrote from a directory an agent controls.
 *
 * `renameSync` and not copy-then-delete: a rename inside one filesystem is atomic, so a scenario
 * can never exist in both places or neither. Returns an outcome rather than throwing, because a
 * file someone already moved or deleted by hand must not fail the status change — the row is
 * what the list renders, and refusing to close a scenario because its file is gone would leave
 * it stuck open forever.
 */
export function moveScenarioFile(
  projectPath: string,
  fromRel: string,
  toRel: string,
): ArchiveOutcome {
  if (!isUsableRelPath(fromRel) || !isUsableRelPath(toRel)) return "refused";
  let root: string;
  try {
    root = statSync(projectPath).isDirectory() ? resolve(projectPath) : "";
  } catch {
    return "missing";
  }
  if (!root) return "refused";

  const from = resolve(root, fromRel);
  const to = resolve(root, toRel);
  if (!isInside(from, root) || !isInside(to, root)) return "refused";

  try {
    // Refuse anything that isn't a plain, singly-linked regular file — the same bar the scan
    // applies when reading one. Moving a symlink into the archive would relocate a pointer at
    // something outside the project; moving a directory would take a tree with it.
    const st = statSync(from);
    if (!st.isFile() || st.nlink !== 1) return "refused";
  } catch {
    return "missing"; // already moved, or never existed
  }

  try {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    return "moved";
  } catch {
    return "refused";
  }
}

/** Where a scenario's file lives once archived. */
export const archivePathFor = (sourcePath: string) => `${ARCHIVE_DIR}/${sourcePath}`;

/* ------------------------------------------------------------------ writing */

export type StatusChange = {
  status: TestScenarioStatus;
  /** True when a person chose this, which pins it against later automatic moves. */
  manual: boolean;
  /** Recorded when a run produced the change. */
  taskId?: string | null;
  passed?: number;
  failed?: number;
};

export type StatusResult = {
  scenario: TestScenario;
  /** What happened to the markdown, when the status change implied a move. */
  file: ArchiveOutcome | "unchanged";
  /** True when the change was refused because a person had already set the status by hand. */
  pinned: boolean;
};

/**
 * Move one scenario's status, archiving or restoring its file to match.
 *
 * Precedence mirrors the backlog's, and it is the rule that makes the automatic half safe: once
 * a person has set a status by hand (`statusOverride`), an automatic change — a passing run —
 * stands down. A person can always change their own mind; a run cannot change it for them.
 */
export function setScenarioStatus(
  project: Pick<Project, "id" | "path">,
  scenario: TestScenario,
  change: StatusChange,
): StatusResult {
  if (!change.manual && scenario.statusOverride) {
    return { scenario, file: "unchanged", pinned: true };
  }

  const wasTerminal = isTerminalScenarioStatus(scenario.status);
  const nowTerminal = isTerminalScenarioStatus(change.status);
  const archived = archivePathFor(scenario.sourcePath);

  let file: ArchiveOutcome | "unchanged" = "unchanged";
  let archivedPath = scenario.archivedPath;

  if (nowTerminal && !scenario.archivedPath) {
    file = moveScenarioFile(project.path, scenario.sourcePath, archived);
    // Record the archive location only when the file actually got there. A row claiming an
    // archived path that holds nothing would make reopening restore a file that isn't there.
    if (file === "moved") archivedPath = archived;
  } else if (!nowTerminal && scenario.archivedPath) {
    file = moveScenarioFile(project.path, scenario.archivedPath, scenario.sourcePath);
    if (file === "moved" || file === "missing") archivedPath = null;
  } else if (wasTerminal && nowTerminal) {
    file = "unchanged"; // passed -> closed, or back: already archived, nothing to move
  }

  const updated = db
    .update(testScenarios)
    .set({
      status: change.status,
      statusOverride: change.manual ? true : scenario.statusOverride,
      archivedPath,
      ...(change.taskId !== undefined ? { lastTaskId: change.taskId } : {}),
      ...(change.taskId !== undefined ? { lastRunAt: new Date() } : {}),
      ...(change.passed !== undefined ? { lastPassed: change.passed } : {}),
      ...(change.failed !== undefined ? { lastFailed: change.failed } : {}),
      updatedAt: new Date(),
    })
    .where(eq(testScenarios.id, scenario.id))
    .returning()
    .get();

  return { scenario: updated, file, pinned: false };
}

/**
 * Close every open scenario in one group — the bulk action on a feature heading.
 *
 * Only `open` rows move. A scenario already `passed` is not re-closed (its file is archived and
 * its outcome is a fact worth keeping distinct from a dismissal), and one already `closed` is a
 * no-op. Returns the rows it changed so the caller can report a count that is true.
 */
export function closeScenarioGroup(
  project: Pick<Project, "id" | "path">,
  featureId: string | null,
): TestScenario[] {
  const rows = db
    .select()
    .from(testScenarios)
    .where(
      and(
        eq(testScenarios.projectId, project.id),
        eq(testScenarios.status, "open"),
        featureId === null
          ? isNull(testScenarios.featureId)
          : eq(testScenarios.featureId, featureId),
      ),
    )
    .all();

  const changed: TestScenario[] = [];
  for (const row of rows) {
    const result = setScenarioStatus(project, row, { status: "closed", manual: true });
    if (!result.pinned) changed.push(result.scenario);
  }
  return changed;
}

/**
 * Record what a `/qa:test` run found, and complete the scenario when it found nothing wrong.
 *
 * The **only** thing that marks a scenario passed. Deliberately not derived from the task
 * reaching `done`: a QA run finishes cleanly having failed half its steps — that is a successful
 * run reporting a broken feature, and conflating the two would mark the broken feature verified.
 * So the qa agent states the counts, and a scenario passes when `failed === 0` and at least one
 * step actually ran.
 */
export function recordScenarioRun(
  project: Pick<Project, "id" | "path">,
  scenario: TestScenario,
  run: { taskId: string | null; passed: number; failed: number },
): StatusResult {
  const clean = run.failed === 0 && run.passed > 0;
  return setScenarioStatus(project, scenario, {
    status: clean ? "passed" : "open",
    manual: false,
    taskId: run.taskId,
    passed: run.passed,
    failed: run.failed,
  });
}

/**
 * Find the scenario a run is talking about, within one project.
 *
 * Matched on `sourcePath` first (what the agent was handed), then on an exact title, then on the
 * file's basename — an agent naturally refers to "checkout.md" or "the checkout scenario" rather
 * than reproducing a project-relative path. Ambiguity resolves to null: marking the wrong
 * scenario passed is worse than asking the agent to be specific.
 */
export function resolveScenarioRef(projectId: string, ref: string): TestScenario | null {
  const needle = ref.trim();
  if (!needle) return null;
  const rows = listTestScenarios(projectId);

  const byPath = rows.filter((r) => r.sourcePath === needle);
  if (byPath.length === 1) return byPath[0];

  const lower = needle.toLowerCase();
  const byTitle = rows.filter((r) => r.title.toLowerCase() === lower);
  if (byTitle.length === 1) return byTitle[0];

  const base = needle.split("/").pop()?.toLowerCase() ?? "";
  const byBase = rows.filter(
    (r) => (r.sourcePath.split("/").pop() ?? "").toLowerCase() === base,
  );
  if (byBase.length === 1) return byBase[0];

  return null;
}

/** Scenario counts per feature, for the feature list's badges. */
export function openScenarioCountsByFeature(projectId: string): Record<string, number> {
  const rows = db
    .select({ featureId: testScenarios.featureId })
    .from(testScenarios)
    .where(and(eq(testScenarios.projectId, projectId), eq(testScenarios.status, "open")))
    .all();
  const out: Record<string, number> = {};
  for (const r of rows) if (r.featureId) out[r.featureId] = (out[r.featureId] ?? 0) + 1;
  return out;
}

/** Re-resolve grouping for rows whose stated feature didn't exist when they were scanned. */
export function regroupOrphanedScenarios(projectId: string): number {
  const orphans = db
    .select()
    .from(testScenarios)
    .where(and(eq(testScenarios.projectId, projectId), isNull(testScenarios.featureId)))
    .all()
    .filter((r) => r.featureHint);
  if (orphans.length === 0) return 0;

  const projectFeatures = db
    .select({ id: features.id, name: features.name })
    .from(features)
    .where(eq(features.projectId, projectId))
    .all();

  const ids: { id: string; featureId: string }[] = [];
  for (const row of orphans) {
    const featureId = matchFeature(row, projectFeatures);
    if (featureId) ids.push({ id: row.id, featureId });
  }
  for (const { id, featureId } of ids) {
    db.update(testScenarios).set({ featureId }).where(eq(testScenarios.id, id)).run();
  }
  return ids.length;
}

/** Bulk lookup used by the project page, which needs both halves in one pass. */
export function projectScenarioView(project: Pick<Project, "id" | "path">) {
  const sync = syncProjectTestScenarios(project);
  regroupOrphanedScenarios(project.id);
  const rows = listTestScenarios(project.id);
  const ids = [...new Set(rows.map((r) => r.featureId).filter(Boolean))] as string[];
  const projectFeatures = ids.length
    ? db
        .select({ id: features.id, name: features.name })
        .from(features)
        .where(inArray(features.id, ids))
        .all()
    : [];
  return { sync, groups: groupScenarios(rows, projectFeatures) };
}
