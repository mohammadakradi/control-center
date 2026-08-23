/**
 * Features — the unit work is actually organised around, and the thing the platform had no
 * word for. `tasks` and `backlog_items` grouped only by project, while the natural grouping
 * key for planned work (the pm agent's `.pm/tasks/<request>/` folder) sat buried inside
 * `backlog_items.source_path` and was never parsed out.
 *
 * Two things create a feature, mirroring how backlog items arrive: the backlog sync derives
 * one per request folder (`ensureRequestFeature`, called from `lib/backlog.ts`), and a person
 * makes one by hand. Both go through here, so the branch-naming rules and the caps can't
 * differ between them.
 *
 * The split with the API routes is the one `lib/backlog.ts` established: every rule, bound and
 * validator lives here where `pnpm test` can reach it, and the routes only translate HTTP.
 */
import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "./db";
import {
  backlogItems,
  features,
  tasks,
  type Feature,
  type FeatureStatus,
  type Task,
  type TaskStatus,
} from "./db/schema";
// `lib/ui.ts` is import-safe here: it pulls in nothing but types, which is also why the update
// route already imports this same set from it.
import { ACTIVE_STATUSES } from "./ui";
import { newId } from "./util";

/** Caps on API-supplied text, same reasoning as the backlog's: the DB has no opinion, and a
 *  feature name is rendered in lists and (via the runner) named in a dispatched preamble. */
export const MAX_FEATURE_NAME_LENGTH = 200;

/**
 * Features per project. Unlike the backlog's cap this counts *every* row, because nothing
 * closes a feature automatically and the sync can create one per request folder on an
 * unauthenticated GET — so this is what bounds a repo full of `.pm/tasks/` folders from
 * growing the table without limit across loads. Well above any real project: this repo has
 * accumulated a few dozen request folders in a year.
 */
export const MAX_FEATURES_PER_PROJECT = 500;

export const FEATURE_STATUSES: readonly FeatureStatus[] = ["active", "done", "cancelled"];

export function isFeatureStatus(v: unknown): v is FeatureStatus {
  return FEATURE_STATUSES.includes(v as FeatureStatus);
}

/** How long the slug part of a branch may get. Branch names are read by humans and typed into
 *  `git checkout`; a 200-character ref is neither. */
const MAX_SLUG_LENGTH = 60;

/** Numbered suffixes tried before falling back to the feature's own id. Small on purpose — a
 *  project with twenty features named the same thing has a naming problem, not a bug. */
const MAX_BRANCH_ATTEMPTS = 20;

/**
 * A feature name as it may be stored: one line, bounded, never blank.
 *
 * Control characters become spaces rather than being dropped or kept, for the reason backlog
 * titles do the same: this name will be interpolated into the preamble a dispatched run is
 * handed, and a newline in it would forge a line there. Cut by code point (`[...]`), not
 * `slice`, so a name ending in an emoji isn't truncated mid-surrogate-pair.
 *
 * Truncating rather than refusing is for the *sync*, which reads a name off disk and has no
 * one to refuse to. The API refuses an over-long name instead (`parseFeatureEdit`), so a
 * client is never told a different name than the one it will get.
 */
export function cleanFeatureName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const collapsed = name
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = [...collapsed].slice(0, MAX_FEATURE_NAME_LENGTH).join("").trim();
  return cut || null;
}

/**
 * The slug part of a feature's branch: lowercase, `[a-z0-9-]` only, no leading, trailing or
 * doubled dash. Empty when the name has nothing usable in it (all punctuation, or entirely
 * non-Latin) — the caller substitutes the feature's id, which is always slug-safe.
 *
 * This is not cosmetic. The result becomes a **git ref** that the runner passes to `git` as an
 * argument, so the character class is an allowlist, and it excludes by construction every
 * shape git or a shell would read as something other than a name: a leading `-` (an option),
 * `..` and `~^:?*[\` (illegal or magic in a refname), whitespace, and a trailing `.` or
 * `.lock` (both refused by `git check-ref-format`).
 */
export function featureSlug(name: string): string {
  const full = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (full.length <= MAX_SLUG_LENGTH) return full;

  // Cut at a word boundary. A request title is a sentence, so a blind slice lands mid-word and
  // ships branch names like `feature/…-so-it-reliably-updates-the` — a ref someone has to type.
  // Only when a boundary is reasonably far in, or a name whose first word is longer than the
  // cap would be cut to nothing.
  const cut = full.slice(0, MAX_SLUG_LENGTH);
  const boundary = cut.lastIndexOf("-");
  const kept = boundary >= MAX_SLUG_LENGTH / 2 ? cut.slice(0, boundary) : cut;
  return kept.replace(/-+$/g, "");
}

/** The branch a feature reserves, before collisions are considered. */
function branchFor(slug: string): string {
  return `feature/${slug}`;
}

/** The random part of a feature id — always slug-safe, so it is the last-resort branch name. */
const idSuffix = (id: string) => id.replace(/^f_/, "") || "unnamed";

/**
 * Pick a branch name for a new feature that no other feature in the project holds.
 *
 * Uniqueness is enforced by the `features_branch_unq` index — this only keeps the common case
 * readable, since two features sharing a ref would merge each other's work. Two concurrent
 * creators can still choose the same name; `createFeature` handles losing that race.
 */
function pickBranch(projectId: string, name: string, id: string): string {
  const base = featureSlug(name) || idSuffix(id);
  const taken = new Set(
    db
      .select({ branch: features.branch })
      .from(features)
      .where(eq(features.projectId, projectId))
      .all()
      .map((r) => r.branch),
  );
  if (!taken.has(branchFor(base))) return branchFor(base);
  for (let n = 2; n <= MAX_BRANCH_ATTEMPTS; n += 1) {
    const candidate = branchFor(`${base}-${n}`);
    if (!taken.has(candidate)) return candidate;
  }
  return branchFor(`${base}-${idSuffix(id)}`);
}

export type NewFeature = {
  name: string;
  /** Project-relative `.pm/tasks/<request>` folder, for a sync-derived feature only. */
  sourceDir?: string | null;
};

/**
 * Create a feature, or return null if a unique index refused the row.
 *
 * Null means one of exactly two things, and both are the caller's to report: the name had
 * nothing usable in it, or a unique index rejected the write — which for the sync means a
 * concurrent load already derived this folder's feature. A branch collision alone is retried
 * once with the id-suffixed form (a name that can only collide with this row's own random id),
 * so it does not surface.
 *
 * `onConflictDoNothing` rather than a `try`/`catch`, and the difference is the point: a blanket
 * catch also swallows a *real* failure — a foreign key violation from a project deleted
 * mid-request, a full disk, a corrupt page — and reports it as a benign naming collision, which
 * would show up as a misleading 409 in the API and as a silently ungrouped item in the sync.
 * This way only a conflict is absorbed (`changes === 0`) and everything else throws, where
 * `loadProjectBacklog` turns it into a visible warning and the route into a 500. Same reasoning,
 * and the same primitive, as the `backlogItems` insert in `lib/backlog.ts`.
 */
export function createFeature(projectId: string, input: NewFeature): Feature | null {
  const name = cleanFeatureName(input.name);
  if (!name) return null;
  const id = newId("f");
  const sourceDir = input.sourceDir ?? null;

  const attempt = (branch: string): boolean =>
    db
      .insert(features)
      .values({ id, projectId, name, branch, sourceDir })
      .onConflictDoNothing()
      .run().changes > 0;

  const stored =
    attempt(pickBranch(projectId, name, id)) ||
    attempt(branchFor(`${featureSlug(name) || "feature"}-${idSuffix(id)}`));
  if (!stored) return null;
  return db.select().from(features).where(eq(features.id, id)).get() ?? null;
}

/** A project's features, oldest first — the order they were planned in, which for sync-derived
 *  ones is the order their request folders were first seen. */
export function listFeatures(projectId: string): Feature[] {
  return db
    .select()
    .from(features)
    .where(eq(features.projectId, projectId))
    .orderBy(asc(features.createdAt), asc(features.id))
    .all();
}

/**
 * Features by id, for a caller that already holds the ids.
 *
 * The cross-project read: `/tasks` lists one user's tasks across every project, so resolving
 * their features per project would be one query per project, and `listFeatures` on each would
 * fetch every feature those projects have rather than the handful actually referenced. Bounded
 * by the ids handed in — an empty list short-circuits, since `inArray` with no values is a
 * degenerate query.
 *
 * Deliberately **not** project-scoped, unlike `findFeature`, and here is the audit trail for why
 * that is safe rather than merely convenient. `tasks.feature_id` has exactly two writers, and
 * both check the feature against the task's *own* project before storing it: `lib/dispatch.ts`
 * (`parseFeatureRef(input.projectId, …)`) and `PATCH /api/tasks/[id]`
 * (`parseFeatureRef(task.projectId, …)`). So a stored id is already known to belong to its
 * task's project, and the one caller here (`/tasks`) draws its ids from `ownedBy`-scoped rows.
 * There is no path by which a client-supplied id reaches this function.
 *
 * That makes this a read over ids the system has already validated — **not** a general-purpose
 * lookup. Anything that takes a `featureId` from a request must still go through
 * `findFeature`/`parseFeatureRef`, and a future caller that cannot show its ids were validated
 * upstream needs a project-scoped variant rather than this one.
 */
export function findFeaturesByIds(ids: readonly string[]): Feature[] {
  if (ids.length === 0) return [];
  return db.select().from(features).where(inArray(features.id, [...ids])).all();
}

/** One feature, but only within the given project — so an id from another project reads as
 *  missing. Every caller that takes a `featureId` from a client goes through this: the same
 *  stance `findBacklogItem` takes, and what stops a forged id linking work across projects. */
export function findFeature(projectId: string, featureId: string): Feature | null {
  return (
    db
      .select()
      .from(features)
      .where(and(eq(features.id, featureId), eq(features.projectId, projectId)))
      .get() ?? null
  );
}

export function featureCount(projectId: string): number {
  return (
    db.select({ n: count() }).from(features).where(eq(features.projectId, projectId)).get()
      ?.n ?? 0
  );
}

/**
 * Find or create the feature for a `.pm/tasks/<request>/` folder, idempotently.
 *
 * Keyed on `(projectId, sourceDir)` by a unique index, so this runs on every backlog load
 * without piling up duplicates. The name is refreshed from disk (a request's `index.md` can be
 * edited, exactly like a spec's body) but **the branch never is**: it is a git ref the runner
 * may already have created, and renaming a feature must not orphan it.
 *
 * Returns null when the project is at its feature cap, or when the name was unusable — the
 * caller leaves those items ungrouped rather than failing the whole backlog load.
 */
export function ensureRequestFeature(
  projectId: string,
  sourceDir: string,
  name: string,
): Feature | null {
  const bySourceDir = () =>
    db
      .select()
      .from(features)
      .where(and(eq(features.projectId, projectId), eq(features.sourceDir, sourceDir)))
      .get() ?? null;

  const existing = bySourceDir();
  if (existing) {
    const wanted = cleanFeatureName(name);
    if (!wanted || wanted === existing.name) return existing;
    db.update(features).set({ name: wanted }).where(eq(features.id, existing.id)).run();
    return { ...existing, name: wanted };
  }

  if (featureCount(projectId) >= MAX_FEATURES_PER_PROJECT) return null;
  // A concurrent load can insert this same folder's feature between the read and the write, in
  // which case the unique index refuses ours and the racer's row is the right answer — so both
  // loads still agree on one feature per folder.
  return createFeature(projectId, { name, sourceDir }) ?? bySourceDir();
}

/**
 * How many backlog items sit under each of a project's features, keyed by feature id.
 *
 * Backlog items only — deliberately not tasks. A backlog item is documented as shared
 * install-wide, so counting them discloses nothing new; a *task* is private to whoever ran it
 * (`lib/task-access.ts`), and an unscoped count of those on a shared page would quietly reveal
 * that someone else is working on this feature. The management card says "task history stays,
 * ungrouped" without a number for exactly that reason.
 */
export function backlogCountsByFeature(projectId: string): Record<string, number> {
  const rows = db
    .select({ featureId: backlogItems.featureId, n: count() })
    .from(backlogItems)
    .where(and(eq(backlogItems.projectId, projectId), isNotNull(backlogItems.featureId)))
    .groupBy(backlogItems.featureId)
    .all();
  const out: Record<string, number> = {};
  for (const row of rows) if (row.featureId) out[row.featureId] = row.n;
  return out;
}

export type FeatureEdit = {
  name?: string;
  status?: FeatureStatus;
};

export function updateFeature(featureId: string, edit: FeatureEdit): Feature {
  const patch: Partial<typeof features.$inferInsert> = {};
  if (edit.name !== undefined) patch.name = edit.name;
  if (edit.status !== undefined) patch.status = edit.status;
  // `branch` is deliberately absent — see ensureRequestFeature.
  db.update(features).set(patch).where(eq(features.id, featureId)).run();
  return db.select().from(features).where(eq(features.id, featureId)).get()!;
}

/**
 * What a delete did, or why it didn't happen. A result type rather than thrown errors, so the
 * route can turn each refusal into its own status and sentence without re-deriving anything.
 */
export type DeleteFeatureResult =
  | {
      ok: true;
      /** How much work was handed back to "no feature" — what the UI has to warn about. */
      ungrouped: { tasks: number; items: number };
      /** Named in the response because deleting the row does *not* delete this. */
      branch: string;
    }
  /** Sync-derived: the next backlog load would re-create it from disk. */
  | { ok: false; reason: "derived"; sourceDir: string }
  /**
   * A run is still in flight against this feature's branch.
   *
   * `count` is for this module's own specs and any future *authenticated* caller — it must not
   * reach an unauthenticated response. It counts every user's active tasks (it has to, to decide
   * whether to refuse), and a task is private to whoever ran it (`lib/task-access.ts`), so
   * naming the number over the no-auth route would tell a stranger how much live work someone
   * else has here. The route's 409 sentence is deliberately count-free; the security audit
   * caught the first version leaking it.
   */
  | { ok: false; reason: "active-tasks"; count: number };

/**
 * Delete a feature, handing its tasks and backlog items back to "no feature".
 *
 * Deletion is the honest verb for "we don't need this group any more" — closing a feature out
 * (`status: done`) keeps it on screen forever as a collapsed heading, which is right for
 * finished work and wrong for a group created by mistake. Four things make it safe:
 *
 * - **Nothing is destroyed.** Both FKs are `set null` (and `foreign_keys` is ON, see
 *   `lib/db/index.ts`), so tasks and backlog items survive the row that grouped them. Closing
 *   out or deleting a feature must never delete the history of the work done under it.
 * - **`mergeState` is cleared by hand, because the FK can't.** `ON DELETE SET NULL` only touches
 *   `feature_id`, which would leave ungrouped tasks carrying `blocked`/`conflict` — breaking the
 *   invariant `setTaskFeature` documents ("`mergeState` null ⇔ no feature") and leaving a chip
 *   that promises a retry the merge sweep can never perform, since it joins through `featureId`.
 * - **A sync-derived feature is refused, not deleted.** `ensureRequestFeature` re-derives one
 *   per `.pm/tasks/<request>/` folder on the next backlog load, so deleting it would appear to
 *   work and then silently undo itself. The same stance renaming one already gets.
 * - **A feature with a live run is refused.** That run's merge-back targets this feature's
 *   branch and reads `featureId` when it finishes (`mergeOnDone`); pulling the row out from
 *   under it would silently drop the merge, leaving committed work on `task/<id>` with nothing
 *   pointing at it. Wait for the run, or cancel it.
 *
 * It never touches git. The `feature/<slug>` ref and every commit on it stay exactly where they
 * are — this module has never run git and doesn't start here (the runner owns that). The branch
 * is returned so the caller can say so.
 */
export function deleteFeature(feature: Feature): DeleteFeatureResult {
  if (feature.sourceDir) {
    return { ok: false, reason: "derived", sourceDir: feature.sourceDir };
  }

  const active = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.featureId, feature.id),
        // A Set<string> because client components match raw status strings against it; the
        // column is typed to the union.
        inArray(tasks.status, [...ACTIVE_STATUSES] as TaskStatus[]),
      ),
    )
    .all();
  if (active.length) {
    return { ok: false, reason: "active-tasks", count: active.length };
  }

  const grouped = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.featureId, feature.id))
    .all();
  const items = db
    .select({ id: backlogItems.id })
    .from(backlogItems)
    .where(eq(backlogItems.featureId, feature.id))
    .all();

  // One transaction, so no reader can observe a row that is ungrouped but still carries a merge
  // state (or the reverse). Both orders are individually safe — the sweep's inner join skips a
  // null `featureId` and its filter skips a null `mergeState` — but "individually safe" is a
  // property of today's queries, and this is cheap.
  db.transaction((tx) => {
    tx.update(tasks)
      .set({ mergeState: null })
      .where(eq(tasks.featureId, feature.id))
      .run();
    tx.delete(features).where(eq(features.id, feature.id)).run();
  });

  return {
    ok: true,
    ungrouped: { tasks: grouped.length, items: items.length },
    branch: feature.branch,
  };
}

/**
 * Fields the request folder owns on a sync-derived feature. Accepting an edit to one would be
 * a lie — the next backlog load re-reads `index.md` and puts it back — so the API refuses and
 * names the folder, exactly as it does for a synced backlog item's title.
 */
const FOLDER_OWNED_FIELDS = ["name"] as const;

export function folderOwnedFeatureEdits(edit: FeatureEdit): string[] {
  return FOLDER_OWNED_FIELDS.filter((field) => edit[field] !== undefined);
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate a client-supplied edit. `branch` and `sourceDir` are deliberately not accepted:
 *  the branch is immutable, and a forged `sourceDir` would park a feature on a folder the sync
 *  then treats as already-derived — the same reasoning as the backlog's `sourcePath`. */
export function parseFeatureEdit(body: unknown): ParseResult<FeatureEdit> {
  const raw: Record<string, unknown> =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const edit: FeatureEdit = {};

  if (raw.name !== undefined) {
    if (typeof raw.name !== "string") return { ok: false, error: "name must be a string" };
    // Refused, not clamped: a client must never be told one name and given another.
    if ([...raw.name].length > MAX_FEATURE_NAME_LENGTH) {
      return {
        ok: false,
        error: `name must be ${MAX_FEATURE_NAME_LENGTH} characters or fewer`,
      };
    }
    const name = cleanFeatureName(raw.name);
    if (!name) return { ok: false, error: "name cannot be empty" };
    edit.name = name;
  }

  if (raw.status !== undefined) {
    if (!isFeatureStatus(raw.status)) {
      return { ok: false, error: `status must be one of ${FEATURE_STATUSES.join(", ")}` };
    }
    edit.status = raw.status;
  }

  return { ok: true, value: edit };
}

/** Same validation, but a name is mandatory — an unnamed feature is unreadable in a list. */
export function parseNewFeature(body: unknown): ParseResult<{ name: string }> {
  const parsed = parseFeatureEdit(body);
  if (!parsed.ok) return parsed;
  if (parsed.value.name === undefined) return { ok: false, error: "name is required" };
  return { ok: true, value: { name: parsed.value.name } };
}

/**
 * Read a client-supplied `featureId` for work in `projectId`.
 *
 * `undefined` means "not mentioned", `null` (or `""`) means "unassign", and a string must name
 * a feature of *this* project. That last clause is the whole point: a feature groups work on
 * one project, so accepting an id from another one would let a caller link work across
 * projects — the refusal `sourcePath` and `linkedTaskId` already get.
 */
export function parseFeatureRef(
  projectId: string,
  value: unknown,
): ParseResult<string | null | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "featureId must be a string or null" };
  }
  if (!findFeature(projectId, value)) {
    return { ok: false, error: "featureId does not name a feature of this project" };
  }
  return { ok: true, value };
}

/** Assign (or, with null, unassign) a task's feature. The caller has already established that
 *  the task is theirs (`findOwnedTask`) and that the feature is the project's.
 *
 *  `mergeState` tracks a task's relationship to *its* feature's branch, so it moves with the
 *  grouping — and the only sound reading is that it describes the **current** feature:
 *  - **ungroup (`featureId → null`) → `mergeState` null.** This is the invariant the whole
 *    codebase relies on ("`mergeState` null ⇔ no feature"): the merge sweep joins through
 *    `featureId`, so a row with no feature can never be retried or reclassified again — a
 *    leftover `blocked`/`conflict`/`no_commits` would show a chip claiming an automatic retry
 *    that nothing will ever perform (correctness review, 2026-08-22).
 *  - **group or move to a feature → `pending`**, unless the feature is unchanged (an
 *    idempotent PATCH keeps the recorded outcome). A recorded `merged`/`conflict` describes a
 *    merge against the branch of *whatever feature the task was on then*; carrying it onto a
 *    different feature's heading would read as "this work is in feature B's branch" when it
 *    isn't. `pending` is the honest "not (yet) merged into this feature's branch". The
 *    grouped-by-hand task was the reason this function had to touch `mergeState` at all — it
 *    used to stay null forever, so the chip silently omitted itself. */
export function setTaskFeature(taskId: string, featureId: string | null): Task | null {
  const current = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!current) return null;
  const mergeState =
    featureId === null
      ? null
      : featureId === current.featureId
        ? current.mergeState
        : "pending";
  db.update(tasks).set({ featureId, mergeState }).where(eq(tasks.id, taskId)).run();
  return db.select().from(tasks).where(eq(tasks.id, taskId)).get() ?? null;
}
