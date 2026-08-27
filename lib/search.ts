/**
 * Global text search over the four things this app is made of: tasks, projects, agents and
 * backlog items.
 *
 * Written to drive an as-you-type command palette, so every choice here is about answering a
 * two-character query cheaply and repeatedly — bounded result counts, bounded query length, and
 * no column whose length a user controls ever reaching the response in full.
 *
 * **Tasks are scoped to the caller; the other three are not, and that asymmetry is the whole
 * security story of this file.** A task and its transcript are private (see lib/task-access),
 * so an unscoped search would be an oracle for other people's runs — type "invoice" and learn
 * that someone on this install is working on invoices. A project is a folder on the device, an
 * agent is an installed plugin, and a backlog describes a folder's planned work: all three are
 * already returned unauthenticated by their own routes, so searching them discloses nothing new.
 *
 * Deliberately plain `LIKE`, not FTS5: nothing here is measured to need an index, and FTS5
 * would mean a schema change plus triggers to keep the shadow tables in step with three tables.
 * If it ever does matter, measure first — the tasks table is the only one that grows without
 * bound, and it grows by one row per run, not one per event.
 *
 * Known limitation, no cheap fix: SQLite folds case for **ASCII only**, so `Ü` does not match
 * `ü`. `lower()` has exactly the same limitation, so working around it needs an ICU build.
 */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "./db";
import {
  agents,
  backlogItems,
  projects,
  tasks,
  type BacklogStatus,
  type TaskStatus,
} from "./db/schema";
import type { BacklogAssignee } from "./pm-spec";
import { ownedBy } from "./task-access";

/**
 * Shortest query we run. One character matches a large fraction of any corpus, so the results
 * are noise and the scan is the most expensive it will ever be. A query below this is answered
 * with empty lists rather than an error: this endpoint is typed into, and an error flash on the
 * first keystroke of every search is noise the palette would have to suppress anyway.
 */
export const MIN_QUERY_LENGTH = 2;

/**
 * Longest query we run. Substring search over a pasted paragraph is never a real intent, and
 * the pattern is bound into nine `LIKE`s across four queries (tasks 2, projects 2, agents 3,
 * backlog 2), plus one more per query for the prefix ranking. Over this the *route*
 * answers 400 so the user is told; `searchAll` independently returns nothing, so no other
 * caller can hand it unbounded text.
 */
export const MAX_QUERY_LENGTH = 200;

/** Results per type when the caller doesn't ask. Sized for a palette's visible list. */
export const DEFAULT_LIMIT = 8;

/** Ceiling on `?limit=`. Four types, so the real bound on one response is 4× this. */
export const MAX_LIMIT = 25;

/**
 * How much of a task's request text comes back. `taskDisplayTitle` falls back to the request
 * for a task that was never titled, so the palette genuinely needs some of it — but a request
 * can be an entire spec file, and 4 × `MAX_LIMIT` of those would be megabytes. Applied in SQL
 * (`substr`), so the untruncated value never enters this process either.
 */
export const SNIPPET_LENGTH = 200;

/** Marks a value the snippet cap cut short. */
const ELLIPSIS = "…";

/**
 * The one character `ESCAPE` designates below — a single backslash.
 *
 * **Bound as a parameter, never written into the SQL text.** Spelling it inline is a trap the
 * specs caught on the first run: in a JS template literal `ESCAPE '\'` is an *escaped quote*, so
 * SQLite received `ESCAPE ''` and answered "ESCAPE expression must be a single character" —
 * i.e. every query threw rather than quietly stopping escaping. Passing it as a value means the
 * character reaching SQLite is the character written here.
 */
const LIKE_ESCAPE = "\\";

export type SearchType = "task" | "project" | "agent" | "backlog";

export type TaskHit = {
  type: "task";
  id: string;
  title: string | null;
  /** Truncated to `SNIPPET_LENGTH`; only for `taskDisplayTitle`'s fallback, not for reading. */
  requestText: string;
  command: string;
  status: TaskStatus;
  projectId: string;
  /** Null only if the project row is gone — the FK is cascade-on-paper but unenforced here. */
  projectName: string | null;
  createdAt: string; // ISO 8601
};

export type ProjectHit = {
  type: "project";
  id: string;
  name: string;
  path: string;
  isGit: boolean;
  isWorkspace: boolean;
};

export type AgentHit = {
  type: "agent";
  id: string;
  name: string;
  namespace: string;
  /** Truncated to `SNIPPET_LENGTH` — a plugin description is free-form text. */
  description: string | null;
};

export type BacklogHit = {
  type: "backlog";
  id: string;
  title: string;
  status: BacklogStatus;
  priority: string | null;
  assignee: BacklogAssignee | null;
  projectId: string;
  projectName: string | null;
};

/**
 * One type's results. `hasMore` says the cap hid something, so the palette can offer "see all"
 * instead of implying it showed everything.
 */
export type SearchGroup<T> = { items: T[]; hasMore: boolean };

export type SearchResults = {
  /**
   * The query as received, trimmed — echoed back on **every** path, including the ones that ran
   * nothing. A debounced client's cheapest staleness guard is `if (res.q !== input) discard`, and
   * blanking this on the too-short path made that guard throw away the very response carrying
   * `tooShort`, so the palette could never show its "keep typing" state. `tooShort` says whether
   * the query ran; `q` says what was asked. One meaning each.
   */
  q: string;
  /** The per-type cap actually applied. */
  limit: number;
  /**
   * True when the query was below `MIN_QUERY_LENGTH`, so the empty lists mean "keep typing"
   * rather than "nothing matched" — the palette shows different copy for each.
   */
  tooShort: boolean;
  tasks: SearchGroup<TaskHit>;
  projects: SearchGroup<ProjectHit>;
  agents: SearchGroup<AgentHit>;
  backlog: SearchGroup<BacklogHit>;
};

/**
 * Neutralise `LIKE`'s wildcards in text a user typed. Searching for `%` must mean the character,
 * not "everything"; `_` must mean the character, not "any character". One pass over a character
 * class, so the escape character it inserts is never re-escaped.
 *
 * This is correctness, not injection defence — the pattern is always a bound parameter.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `${LIKE_ESCAPE}${c}`);
}

/** `<col> LIKE <pattern> ESCAPE '\'`, for one column. */
function matches(column: AnySQLiteColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE ${LIKE_ESCAPE}`;
}

/** True when *any* of these columns contains the query. Parenthesised so it can be `and`ed. */
function matchesAny(pattern: string, ...columns: AnySQLiteColumn[]): SQL {
  return sql`(${sql.join(
    columns.map((c) => matches(c, pattern)),
    sql` OR `,
  )})`;
}

/**
 * Sort key putting rows whose display column *starts with* the query first. Typing "up" should
 * surface "Update banner" ahead of a task that merely mentions an update halfway through its
 * request. Ascending (0 before 1), so it goes first in `orderBy`.
 */
function prefixFirst(column: AnySQLiteColumn, prefix: string): SQL {
  return sql`CASE WHEN ${matches(column, prefix)} THEN 0 ELSE 1 END`;
}

/** A length-capped projection of a text column, so the cap holds at the database boundary. */
function snippetOf(column: AnySQLiteColumn) {
  // One character past the cap, purely so the mapper can tell "exactly at the cap" from "cut".
  return sql<string | null>`substr(${column}, 1, ${SNIPPET_LENGTH + 1})`;
}

/**
 * Finish the cap `snippetOf` started, in the same units it used.
 *
 * **Counted and cut by code point, not by `String.length`** — the two disagree, and both halves
 * of that mattered here. SQLite's `substr` counts characters, so 150 emoji (300 UTF-16 units)
 * come back whole; comparing that against `SNIPPET_LENGTH` with `.length` reported it as
 * over-long and cut a perfectly short request in half. And `slice` at a UTF-16 offset can land
 * *inside* a surrogate pair, which renders as a replacement character. Same reasoning as
 * `cleanTitle` in lib/dispatch.ts.
 */
function trimSnippet(value: string | null): string {
  if (!value) return "";
  const chars = [...value];
  return chars.length > SNIPPET_LENGTH
    ? `${chars.slice(0, SNIPPET_LENGTH).join("")}${ELLIPSIS}`
    : value;
}

/**
 * Split an over-fetched row set into the capped page plus whether anything was hidden. Fetching
 * `limit + 1` rows is what makes `hasMore` free — four `COUNT(*)`s over the same predicates
 * would double the work to report a boolean.
 */
function group<T>(rows: T[], limit: number): SearchGroup<T> {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

function emptyResults(q: string, limit: number, tooShort: boolean): SearchResults {
  const none = { items: [], hasMore: false };
  return { q, limit, tooShort, tasks: none, projects: none, agents: none, backlog: none };
}

/**
 * Validate a `?q=` value. Absent, empty or short is **valid** — it produces the "keep typing"
 * response, because this endpoint is called on every keystroke. Only an over-long query is an
 * error, and it's an explicit one rather than a silent truncation: substring results that don't
 * contain what you pasted would be a lie about what was searched.
 */
export function parseSearchQuery(
  value: string | null,
): { ok: true; value: string } | { ok: false; error: string } {
  const text = (value ?? "").trim();
  if (text.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      error: `Search for ${MAX_QUERY_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, value: text };
}

/**
 * Validate a `?limit=` value: absent/empty → `DEFAULT_LIMIT`, a whole number in 1…`MAX_LIMIT`
 * → itself, anything else → `null` for the caller to reject. An out-of-range limit is refused
 * rather than clamped, for the same reason as the query length.
 */
export function parseSearchLimit(value: string | null): number | null {
  if (value === null || value === "") return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= MAX_LIMIT ? n : null;
}

/**
 * Run one query against all four types.
 *
 * `userId` scopes the tasks half only — see the file header for why the other three are shared.
 * `q` is expected to have been through `parseSearchQuery`; the guards below are so that a caller
 * who skipped it gets nothing rather than an unbounded scan.
 */
export function searchAll(
  userId: string,
  { q, limit = DEFAULT_LIMIT }: { q: string; limit?: number },
): SearchResults {
  const text = q.trim();
  const capped = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  if (text.length < MIN_QUERY_LENGTH) return emptyResults(text, capped, true);
  // Fail closed rather than build a 5 000-character pattern for a caller that skipped the route.
  if (text.length > MAX_QUERY_LENGTH) return emptyResults(text, capped, false);

  const escaped = escapeLike(text);
  const contains = `%${escaped}%`;
  const prefix = `${escaped}%`;
  const take = capped + 1;

  // LEFT join, not inner: `tasks.project_id` is NOT NULL with a cascade FK on paper, but FK
  // enforcement in the real database is unreliable (see .swe/notes/gotchas-1.md), and a task that matched
  // must not vanish from search because its project row is missing.
  const taskRows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      requestText: snippetOf(tasks.requestText),
      command: tasks.command,
      status: tasks.status,
      projectId: tasks.projectId,
      projectName: projects.name,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(ownedBy(userId), matchesAny(contains, tasks.title, tasks.requestText)))
    // Newest first within each rank, then id so equal rows come back in a stable order.
    .orderBy(prefixFirst(tasks.title, prefix), desc(tasks.createdAt), asc(tasks.id))
    .limit(take)
    .all();

  // Path as well as name: a project is a folder, and "which install has ~/Dev/foo registered"
  // is how you look for one. No new disclosure — `GET /api/projects` already returns every path.
  const projectRows = db
    .select({
      id: projects.id,
      name: projects.name,
      path: projects.path,
      isGit: projects.isGit,
      isWorkspace: projects.isWorkspace,
    })
    .from(projects)
    .where(matchesAny(contains, projects.name, projects.path))
    .orderBy(prefixFirst(projects.name, prefix), asc(projects.name), asc(projects.id))
    .limit(take)
    .all();

  const agentRows = db
    .select({
      id: agents.id,
      name: agents.name,
      namespace: agents.namespace,
      description: snippetOf(agents.description),
    })
    .from(agents)
    .where(matchesAny(contains, agents.name, agents.namespace, agents.description))
    .orderBy(prefixFirst(agents.name, prefix), asc(agents.name), asc(agents.id))
    .limit(take)
    .all();

  // Matched on the body but the body is **not** returned: an item's description runs to 20 000
  // characters, the palette renders a title, and a backlog title is never empty (schema + the
  // validation in lib/backlog), so unlike a task there is no fallback text to supply.
  const backlogRows = db
    .select({
      id: backlogItems.id,
      title: backlogItems.title,
      status: backlogItems.status,
      priority: backlogItems.priority,
      assignee: backlogItems.assignee,
      projectId: backlogItems.projectId,
      projectName: projects.name,
    })
    .from(backlogItems)
    .leftJoin(projects, eq(backlogItems.projectId, projects.id))
    .where(matchesAny(contains, backlogItems.title, backlogItems.description))
    .orderBy(
      prefixFirst(backlogItems.title, prefix),
      desc(backlogItems.updatedAt),
      asc(backlogItems.id),
    )
    .limit(take)
    .all();

  return {
    q: text,
    limit: capped,
    tooShort: false,
    tasks: group(
      taskRows.map((t) => ({
        type: "task" as const,
        ...t,
        requestText: trimSnippet(t.requestText),
        createdAt: t.createdAt.toISOString(),
      })),
      capped,
    ),
    projects: group(
      projectRows.map((p) => ({ type: "project" as const, ...p })),
      capped,
    ),
    agents: group(
      agentRows.map((a) => ({
        type: "agent" as const,
        ...a,
        description: a.description === null ? null : trimSnippet(a.description),
      })),
      capped,
    ),
    backlog: group(
      backlogRows.map((b) => ({ type: "backlog" as const, ...b })),
      capped,
    ),
  };
}
