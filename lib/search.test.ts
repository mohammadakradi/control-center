/**
 * Specs for global search.
 *
 * Two properties carry the feature. The tasks half is **owner-scoped** — it is the only private
 * one of the four types, so a leak here would turn a text box into an oracle for other people's
 * runs. And the query is user text going into a `LIKE` pattern, so its wildcards must be inert:
 * searching for `%` must find the character, not every row in the table.
 *
 * The rest pins the bounds a palette depends on (per-type caps, `hasMore`, snippet truncation)
 * and the one field deliberately *not* returned: a backlog item's body.
 *
 * Runs against a throwaway SQLite file built from the committed migrations — never
 * `data/platform.db`.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(tmpdir(), "platform-search-test-"));
const dbFile = join(root, "test.db");

// Point the shared connection at the throwaway file BEFORE lib/db is imported.
process.env.PLATFORM_DB = dbFile;

type Search = typeof import("./search");
let search: Search;
let db: typeof import("./db").db;
let schema: typeof import("./db/schema");

const ALICE = "user_alice";
const BOB = "user_bob";

/** Longer than the snippet cap, so truncation is observable. */
const LONG_REQUEST = `Fix the update banner ${"x".repeat(400)}`;

before(async () => {
  const { migrateDatabase } = await import("./db/migrate");
  migrateDatabase({
    dbPath: dbFile,
    migrationsFolder: resolve(import.meta.dirname, "..", "drizzle"),
    backup: false,
  });

  search = await import("./search");
  ({ db } = await import("./db"));
  schema = await import("./db/schema");

  // Guard: if the env override ever stopped working, fail loudly rather than reading the real
  // database (and reporting someone's actual tasks as test results).
  const file = (db.$client as { name: string }).name;
  assert.equal(file, dbFile, `refusing to run: connected to ${file}`);

  db.insert(schema.users)
    .values([
      { id: ALICE, email: "alice@example.com", passwordHash: "!" },
      { id: BOB, email: "bob@example.com", passwordHash: "!" },
    ])
    .run();

  db.insert(schema.projects)
    .values([
      { id: "p1", name: "Agent Platform", path: "/Users/dev/Dev/agent/platform", isGit: true },
      { id: "p2", name: "Matcher", path: "/Users/dev/Dev/matcher", isGit: true },
      // Name contains LIKE wildcards, so a query for them can be told from "match everything".
      { id: "p3", name: "100% _underscore_ demo", path: "/Users/dev/Dev/wild" },
    ])
    .run();

  db.insert(schema.agents)
    .values([
      {
        id: "swe@bundled",
        name: "swe-agent",
        namespace: "swe",
        sourcePath: "/agents/swe",
        pluginId: "swe",
        description: `Backend and infrastructure specialist. ${"y".repeat(400)}`,
      },
      {
        id: "fe@bundled",
        name: "fe-agent",
        namespace: "fe",
        sourcePath: "/agents/fe",
        pluginId: "fe",
        description: null,
      },
      // Name sorts FIRST while its id sorts LAST — so an ordering test can tell `asc(name)`
      // from `asc(id)`, which two identically-ordered fixtures could not.
      {
        id: "zz@bundled",
        name: "aa-agent",
        namespace: "aa",
        sourcePath: "/agents/aa",
        pluginId: "aa",
        description: "Ordering fixture.",
      },
    ])
    .run();

  const task = (
    id: string,
    userId: string | null,
    fields: { title?: string | null; requestText?: string; projectId?: string } = {},
  ) => ({
    id,
    userId,
    projectId: fields.projectId ?? "p1",
    agentId: "swe@bundled",
    command: "task",
    title: fields.title ?? null,
    requestText: fields.requestText ?? "",
    // Distinct, ascending creation times so "newest first" is a real assertion.
    createdAt: new Date(1_760_000_000_000 + Number(id.replace(/\D/g, "")) * 1_000),
  });

  db.insert(schema.tasks)
    .values([
      task("t1", ALICE, { title: "Update banner polish" }),
      task("t2", ALICE, { title: "Toast attention system" }),
      // Untitled: only reachable through requestText, which is also the palette's fallback text.
      task("t3", ALICE, { requestText: LONG_REQUEST }),
      task("t4", ALICE, { title: "Something about the update flow", projectId: "p2" }),
      // Bob's — must never appear in Alice's results.
      task("t5", BOB, { title: "Bob's secret update work" }),
      // Predates `tasks.user_id`. Excluded, exactly as every other task read excludes it.
      task("t6", null, { title: "Legacy unowned update task" }),
      // 150 code points but 300 UTF-16 units: under the snippet cap in the units SQLite counts,
      // over it in the units `String.length` counts.
      task("t7", ALICE, { requestText: `emoji request ${"😀".repeat(150)}` }),
      // Genuinely over the cap, and the prefix length puts a surrogate pair astride UTF-16
      // offset 200 — a naive `slice(0, 200)` splits it.
      task("t8", ALICE, { requestText: `wide request ${"😀".repeat(250)}` }),
    ])
    .run();

  db.insert(schema.backlogItems)
    .values([
      {
        id: "b1",
        projectId: "p1",
        title: "Command palette",
        description: `A body nobody asked for. ${"z".repeat(2000)}`,
        assignee: "fe",
        priority: "P2",
        updatedAt: new Date(1_760_000_100_000),
      },
      {
        id: "b2",
        projectId: "p2",
        title: "Unrelated title",
        description: "Mentions the update banner only in the body.",
        status: "done",
        updatedAt: new Date(1_760_000_200_000),
      },
      // A pair sharing a body token, with title order and updatedAt order deliberately opposed,
      // so `desc(updatedAt)` can be told apart from `asc(title)` and from `asc(id)`.
      {
        id: "b3",
        projectId: "p1",
        title: "Alpha ordering fixture",
        description: "shared-token marker",
        updatedAt: new Date(1_760_000_300_000),
      },
      {
        id: "b4",
        projectId: "p1",
        title: "Zeta ordering fixture",
        description: "shared-token marker",
        updatedAt: new Date(1_760_000_400_000),
      },
    ])
    .run();

  // A task pointing at a project row that doesn't exist — what the LEFT join in `searchAll`
  // exists for. It takes a pragma to build: a freshly migrated database DOES enforce the foreign
  // key (`SQLITE_CONSTRAINT_FOREIGNKEY`, found by trying), so this state is only reachable where
  // enforcement lapsed — which is exactly the condition .swe/notes/gotchas-1.md records for the real
  // database, and why the join isn't an inner one.
  const raw = db.$client as unknown as { pragma(s: string): unknown };
  raw.pragma("foreign_keys = OFF");
  db.insert(schema.tasks)
    .values({
      id: "t9",
      userId: ALICE,
      projectId: "p-gone",
      agentId: "swe@bundled",
      command: "task",
      title: "An orphan task",
      createdAt: new Date(1_760_000_009_000),
    })
    .run();
  raw.pragma("foreign_keys = ON");
});

after(() => rmSync(root, { recursive: true, force: true }));

/** Search as Alice with the defaults. */
function find(q: string, limit?: number) {
  return search.searchAll(ALICE, limit === undefined ? { q } : { q, limit });
}

// ------------------------------------------------------------------ ownership

test("tasks are scoped to the caller — another owner's matching task never appears", () => {
  const mine = find("update");
  const ids = mine.tasks.items.map((t) => t.id);
  assert.ok(ids.includes("t1"), "my own matching task is found");
  assert.ok(!ids.includes("t5"), "Bob's task must not leak into Alice's search");
  assert.ok(!ids.includes("t6"), "an unowned task is not mine either");

  // And the reverse direction, so the scoping isn't accidentally keyed to one user.
  const bobs = search.searchAll(BOB, { q: "update" });
  assert.deepEqual(
    bobs.tasks.items.map((t) => t.id),
    ["t5"],
  );
});

test("a query matching nothing of mine still returns the shared types", () => {
  // "matcher" hits a project but none of Alice's tasks: the shared half is not gated on the
  // private half having results.
  const r = find("matcher");
  assert.deepEqual(r.tasks.items, []);
  assert.deepEqual(
    r.projects.items.map((p) => p.id),
    ["p2"],
  );
});

test("backlog items are searched across every project, and their bodies are not returned", () => {
  const r = find("update banner");
  // b2 belongs to p2 and matched on its description only — backlogs are shared by design.
  assert.deepEqual(
    r.backlog.items.map((b) => b.id),
    ["b2"],
  );
  const hit = r.backlog.items[0];
  assert.equal(hit.projectName, "Matcher", "the project name is joined in for the palette");
  assert.equal(hit.status, "done");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(hit, "description"),
    "a 20 000-character body must never ride along in a search response",
  );
});

// ------------------------------------------------------------------ wildcards

test("LIKE wildcards in the query are inert", () => {
  // Without escaping, `%` is "match everything" and would return every row of all four types.
  const pct = find("100%");
  assert.deepEqual(
    pct.projects.items.map((p) => p.id),
    ["p3"],
    "`%` must match the character, not every project",
  );
  assert.deepEqual(pct.tasks.items, [], "and it must not sweep up the other types either");

  // `_` is LIKE's single-character wildcard: unescaped, "_underscore_" would also match
  // anything of the same shape, and `_u` would match every two-character sequence ending in u.
  assert.deepEqual(
    find("_underscore_").projects.items.map((p) => p.id),
    ["p3"],
  );
  assert.deepEqual(find("1_0%").projects.items, [], "`_` must not stand in for `0`");
});

test("escapeLike escapes the escape character itself, and only once", () => {
  assert.equal(search.escapeLike("100%"), "100\\%");
  assert.equal(search.escapeLike("a_b"), "a\\_b");
  assert.equal(search.escapeLike("c:\\path"), "c:\\\\path");
  assert.equal(search.escapeLike("plain"), "plain");
});

// ------------------------------------------------------------------ matching

test("a task is found by its request text when it has no title", () => {
  const r = find("Fix the update");
  const hit = r.tasks.items.find((t) => t.id === "t3");
  assert.ok(hit, "an untitled task must be reachable through its request");
  assert.equal(hit.title, null);
});

test("request text is truncated at the snippet cap", () => {
  const hit = find("Fix the update").tasks.items.find((t) => t.id === "t3");
  assert.ok(hit);
  assert.equal(hit.requestText.length, search.SNIPPET_LENGTH + 1, "cap plus the ellipsis");
  assert.ok(hit.requestText.endsWith("…"));
  assert.ok(hit.requestText.startsWith("Fix the update banner"));
});

test("the snippet cap counts code points, like the SQL substr it finishes", () => {
  // 150 emoji is 300 UTF-16 units but only 150 characters — comfortably under the cap. Measuring
  // it with `String.length` reported it as over-long and cut a short request in half; slicing at
  // a UTF-16 offset can also land inside a surrogate pair and render as a replacement character.
  const hit = find("emoji request").tasks.items.find((t) => t.id === "t7");
  assert.ok(hit);
  assert.equal(hit.requestText, `emoji request ${"😀".repeat(150)}`, "not truncated at all");
  assert.ok(!hit.requestText.includes("…"));
  assert.ok(!/[\uD800-\uDFFF]/.test(hit.requestText.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")),
    "no lone surrogate survived");

  // And one that genuinely IS over the cap in code points still gets cut cleanly.
  const long = find("wide request").tasks.items.find((t) => t.id === "t8");
  assert.ok(long);
  assert.equal([...long.requestText].length, search.SNIPPET_LENGTH + 1, "cap plus the ellipsis");
  assert.ok(long.requestText.endsWith("…"));
  assert.ok(
    !/[\uD800-\uDBFF]$/.test(long.requestText.slice(0, -1)),
    "the cut must not split a surrogate pair",
  );
});

test("an agent description is truncated the same way, and a null one stays null", () => {
  const r = find("agent");
  const swe = r.agents.items.find((a) => a.id === "swe@bundled");
  const fe = r.agents.items.find((a) => a.id === "fe@bundled");
  assert.ok(swe, "the swe agent matched");
  assert.ok(swe.description, "and it has a description to truncate");
  assert.ok(swe.description.endsWith("…"));
  assert.equal(swe.description.length, search.SNIPPET_LENGTH + 1);
  assert.equal(fe?.description, null, "a missing description is not an empty string");
});

test("matching is case-insensitive for ASCII", () => {
  assert.ok(find("UPDATE BANNER").tasks.items.some((t) => t.id === "t1"));
  assert.ok(find("aGeNt PlAtFoRm").projects.items.some((p) => p.id === "p1"));
});

test("agents match on namespace as well as name and description", () => {
  assert.deepEqual(
    find("infrastructure").agents.items.map((a) => a.id),
    ["swe@bundled"],
    "description",
  );
  assert.deepEqual(
    find("fe-").agents.items.map((a) => a.id),
    ["fe@bundled"],
    "name",
  );
});

test("projects match on path, not just name", () => {
  assert.deepEqual(
    find("Dev/agent").projects.items.map((p) => p.id),
    ["p1"],
  );
});

test("prefix matches rank ahead of mid-string ones, then newest first", () => {
  const ids = find("update").tasks.items.map((t) => t.id);
  // Asserted as the whole sequence, not just `ids[0]`: the round-one review proved the looser
  // version (`ids[0] === "t1"` plus `indexOf("t4") > 0`) still passed with the tie-breaker
  // flipped to `asc(createdAt)`, so the "newest first" half of this test's own name was
  // unenforced. t1's title *starts with* the query, so it ranks first; t4 (newer) and t3
  // (older, matched only through its request text) follow newest-first.
  assert.deepEqual(ids, ["t1", "t4", "t3"]);
});

test("projects tie-break by name, and hasMore is reported for a non-task group too", () => {
  // Every fixture path contains "Dev/", so all three match and nothing prefix-matches on name —
  // which leaves the secondary sort as the only thing deciding the order. Sorting by id instead
  // would give p1, p2, p3.
  assert.deepEqual(
    find("Dev/").projects.items.map((p) => p.id),
    ["p3", "p1", "p2"],
    "ascending by name: '100% …' < 'Agent Platform' < 'Matcher'",
  );

  // The `hasMore: true` branch was only ever exercised for tasks.
  const capped = find("Dev/", 2);
  assert.deepEqual(
    capped.projects.items.map((p) => p.id),
    ["p3", "p1"],
  );
  assert.equal(capped.projects.hasMore, true);
});

test("agents tie-break by name, not by id", () => {
  // a3's name sorts first while its id sorts last, so this fails if the secondary sort is `id`.
  assert.deepEqual(
    find("-agent").agents.items.map((a) => a.name),
    ["aa-agent", "fe-agent", "swe-agent"],
  );
});

test("backlog items tie-break most-recently-updated first", () => {
  // Neither title prefix-matches, so `desc(updatedAt)` decides. b4 is the newer one; ordering by
  // title or by id ascending would put b3 first instead.
  const r = find("shared-token");
  assert.deepEqual(
    r.backlog.items.map((b) => b.id),
    ["b4", "b3"],
  );

  const capped = find("shared-token", 1);
  assert.deepEqual(
    capped.backlog.items.map((b) => b.id),
    ["b4"],
  );
  assert.equal(capped.backlog.hasMore, true);
});

test("a task whose project row is gone still comes back, with a null project name", () => {
  // The join is LEFT on purpose: `tasks.project_id` is NOT NULL with a cascade FK on paper, but
  // FK enforcement in the real database is unreliable (.swe/notes/gotchas-1.md), and a matched task must
  // not silently vanish from search because its project row went missing.
  const hit = find("orphan task").tasks.items.find((t) => t.id === "t9");
  assert.ok(hit, "an orphaned task is still findable");
  assert.equal(hit.projectId, "p-gone");
  assert.equal(hit.projectName, null);
});

test("a matched task carries the fields the palette renders", () => {
  const hit = find("Toast attention").tasks.items[0];
  assert.equal(hit.type, "task");
  assert.equal(hit.id, "t2");
  assert.equal(hit.status, "queued");
  assert.equal(hit.command, "task");
  assert.equal(hit.projectId, "p1");
  assert.equal(hit.projectName, "Agent Platform");
  assert.equal(hit.createdAt, new Date(1_760_000_000_000 + 2_000).toISOString());
});

test("every hit is type-tagged", () => {
  const r = find("update");
  assert.ok(r.tasks.items.every((h) => h.type === "task"));
  assert.ok(r.backlog.items.every((h) => h.type === "backlog"));
  assert.ok(find("Dev").projects.items.every((h) => h.type === "project"));
  assert.ok(find("agent").agents.items.every((h) => h.type === "agent"));
});

// --------------------------------------------------------------------- bounds

test("a short query runs nothing and says why", () => {
  const r = find("u");
  assert.equal(r.tooShort, true);
  // Echoed back even though nothing ran: a debounced client's staleness guard compares this to
  // what it typed, and blanking it made that guard discard the "keep typing" response itself.
  assert.equal(r.q, "u");
  assert.deepEqual(r.tasks.items, []);
  assert.deepEqual(r.projects.items, []);
  assert.equal(r.tasks.hasMore, false);
  assert.equal(r.backlog.hasMore, false);

  // Whitespace-only is short, not a match-everything query.
  assert.equal(find("   ").tooShort, true);
  assert.equal(find("   ").q, "", "trimmed to nothing, so nothing is what it echoes");
});

test("an over-long query returns nothing rather than a 200-character LIKE pattern", () => {
  const r = find("u".repeat(search.MAX_QUERY_LENGTH + 1));
  assert.equal(r.tooShort, false, "it isn't short — it's refused");
  assert.deepEqual(r.tasks.items, []);
  assert.deepEqual(r.projects.items, []);
  assert.deepEqual(r.agents.items, []);
  assert.deepEqual(r.backlog.items, []);
});

test("the query is trimmed before it is searched", () => {
  const r = find("  update banner  ");
  assert.equal(r.q, "update banner");
  assert.ok(r.tasks.items.some((t) => t.id === "t1"));
});

test("results are capped per type and hasMore reports what the cap hid", () => {
  const one = find("update", 1);
  assert.equal(one.limit, 1);
  assert.equal(one.tasks.items.length, 1);
  assert.equal(one.tasks.hasMore, true, "Alice has more than one matching task");
  assert.equal(one.projects.hasMore, false, "no project matches at all");

  const all = find("update", 10);
  assert.equal(all.tasks.hasMore, false);
  assert.ok(all.tasks.items.length > 1);
});

test("a limit outside the range is clamped rather than trusted", () => {
  // The route refuses these; searchAll is what makes any other caller safe.
  assert.equal(find("update", 9999).limit, search.MAX_LIMIT);
  assert.equal(find("update", 0).limit, 1);
  assert.equal(find("update", -5).limit, 1);
  assert.equal(find("update", Number.NaN).limit, search.DEFAULT_LIMIT);
  assert.equal(find("update", 2.7).limit, 2, "a fractional limit is truncated, not rounded up");
  assert.equal(find("update").limit, search.DEFAULT_LIMIT);
});

// ------------------------------------------------------------- input parsing

test("parseSearchQuery accepts short and absent queries, refuses over-long ones", () => {
  assert.deepEqual(search.parseSearchQuery(null), { ok: true, value: "" });
  assert.deepEqual(search.parseSearchQuery(""), { ok: true, value: "" });
  assert.deepEqual(search.parseSearchQuery("  x  "), { ok: true, value: "x" });
  assert.deepEqual(search.parseSearchQuery("update"), { ok: true, value: "update" });

  const long = search.parseSearchQuery("u".repeat(search.MAX_QUERY_LENGTH + 1));
  assert.equal(long.ok, false);

  // Exactly at the cap is fine, and trailing whitespace is trimmed before it is measured.
  const atCap = "u".repeat(search.MAX_QUERY_LENGTH);
  assert.deepEqual(search.parseSearchQuery(atCap), { ok: true, value: atCap });
  assert.deepEqual(search.parseSearchQuery(`  ${atCap}  `), { ok: true, value: atCap });
});

test("parseSearchLimit takes whole numbers in range and nothing else", () => {
  assert.equal(search.parseSearchLimit(null), search.DEFAULT_LIMIT);
  assert.equal(search.parseSearchLimit(""), search.DEFAULT_LIMIT);
  assert.equal(search.parseSearchLimit("1"), 1);
  assert.equal(search.parseSearchLimit(String(search.MAX_LIMIT)), search.MAX_LIMIT);

  for (const bad of [
    "0",
    "-1",
    String(search.MAX_LIMIT + 1),
    "1.5",
    "abc",
    "8abc",
    " 8",
    "1e3",
    "0x10",
    "Infinity",
    "9".repeat(400),
  ]) {
    assert.equal(search.parseSearchLimit(bad), null, `limit=${bad} must be refused`);
  }
});
