/**
 * Unit tests for the command palette's data model. Pure functions plus one module store — no
 * DOM, no database.
 *
 * The failures worth pinning here are the ones that render perfectly while being wrong: a row
 * that navigates to the wrong id, a section that keeps a heading with nothing under it, a
 * highlight index that walks off the end of the list, or an empty row for a task that was never
 * titled. None of those look like bugs on screen.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROJECT_ACTIONS,
  closePalette,
  filterEntries,
  flattenEntries,
  getPaletteOpen,
  getServerPaletteOpen,
  matchesQuery,
  moveActive,
  openPalette,
  paletteSections,
  subscribePaletteOpen,
  togglePalette,
  type NavEntry,
  type PaletteEntry,
} from "./command-palette";
import type { SearchResults } from "./search";

const NAV: NavEntry[] = [
  { href: "/", label: "Dashboard" },
  { href: "/projects", label: "Projects" },
  { href: "/settings", label: "Settings", keywords: ["token", "anthropic"] },
];

/** An empty group, so a fixture only has to name the type it cares about. */
const none = { items: [], hasMore: false };

function results(over: Partial<SearchResults> = {}): SearchResults {
  return {
    q: "x",
    limit: 8,
    tooShort: false,
    tasks: none,
    projects: none,
    agents: none,
    backlog: none,
    ...over,
  };
}

function project(id: string, name: string, path = `/Users/me/${name}`) {
  return { type: "project" as const, id, name, path, isGit: true, isWorkspace: false };
}

function task(over: Partial<SearchResults["tasks"]["items"][number]> = {}) {
  return {
    type: "task" as const,
    id: "task_1",
    title: "Add invoice approval",
    requestText: "please add a flow…",
    command: "task",
    status: "done" as const,
    projectId: "proj_1",
    projectName: "platform",
    createdAt: "2026-08-20T00:00:00.000Z",
    ...over,
  };
}

const section = (sections: ReturnType<typeof paletteSections>, id: string) =>
  sections.find((s) => s.id === id);

const labels = (entries: PaletteEntry[]) => entries.map((e) => e.label);

// --- static rows ----------------------------------------------------------

test("an empty query offers the nav pages and the theme actions, and nothing else", () => {
  const sections = paletteSections({
    navLinks: NAV,
    themeMode: "system",
    query: "",
    results: null,
  });

  assert.deepEqual(
    sections.map((s) => s.id),
    ["pages", "actions"],
  );
  assert.deepEqual(labels(section(sections, "pages")!.entries), [
    "Dashboard",
    "Projects",
    "Settings",
  ]);
  assert.deepEqual(labels(section(sections, "actions")!.entries), [
    "Light theme",
    "Dark theme",
    "System theme",
  ]);
});

test("a page matches on a keyword its label never mentions", () => {
  // The point of `keywords`: nothing in "Settings" says "token", but that is what someone
  // looking for the Anthropic token would type.
  const sections = paletteSections({
    navLinks: NAV,
    themeMode: "dark",
    query: "token",
    results: null,
  });
  assert.deepEqual(labels(section(sections, "pages")!.entries), ["Settings"]);
});

test("the current theme is marked rather than hidden", () => {
  const sections = paletteSections({
    navLinks: NAV,
    themeMode: "dark",
    query: "",
    results: null,
  });
  const themes = section(sections, "actions")!.entries;
  assert.deepEqual(
    themes.map((e) => [e.label, e.current === true]),
    [
      ["Light theme", false],
      ["Dark theme", true],
      ["System theme", false],
    ],
  );
});

test("a section with no matching rows is dropped, not rendered empty", () => {
  // A heading with nothing under it reads as a failed load.
  const sections = paletteSections({
    navLinks: NAV,
    themeMode: "system",
    query: "zzzz",
    results: null,
  });
  assert.deepEqual(sections, []);
});

test("matchesQuery is case-insensitive across label, description and keywords", () => {
  const entry: PaletteEntry = {
    key: "k",
    kind: "project",
    label: "Platform",
    description: "/Users/me/Dev/agent/platform",
    keywords: ["Repo"],
  };
  assert.equal(matchesQuery(entry, "PLAT"), true);
  assert.equal(matchesQuery(entry, "dev/agent"), true);
  assert.equal(matchesQuery(entry, "repo"), true);
  assert.equal(matchesQuery(entry, "nope"), false);
  // Whitespace-only is the same as no query at all — everything matches.
  assert.equal(matchesQuery(entry, "   "), true);
});

test("a keyword matches by prefix, but visible text matches anywhere", () => {
  // The asymmetry that stops an invisible keyword hijacking a query aimed elsewhere: "ok" must
  // not pull in a row keyed on "token", while "theme" still matches the label "Dark theme".
  const settings: PaletteEntry = {
    key: "page:/settings",
    kind: "page",
    label: "Settings",
    keywords: ["token"],
  };
  assert.equal(matchesQuery(settings, "tok"), true);
  assert.equal(matchesQuery(settings, "ok"), false);
  assert.equal(matchesQuery({ key: "t", kind: "theme", label: "Dark theme" }, "theme"), true);
});

test("a plausible project query does not drag the theme rows in front of it", () => {
  // The regression this cost: "appearance" was a theme keyword, so typing "app" to reach a
  // project called app-0 put three theme rows above it.
  const sections = paletteSections({
    navLinks: [],
    themeMode: "system",
    query: "app",
    results: results({ projects: { items: [project("proj_0", "app-0")], hasMore: false } }),
  });
  assert.deepEqual(
    sections.map((s) => s.id),
    ["actions", "projects"],
  );
  // Only the project's own "New task in …" action, no themes.
  assert.deepEqual(labels(section(sections, "actions")!.entries), ["New task in app-0"]);
});

test("filterEntries keeps the caller's order", () => {
  const entries: PaletteEntry[] = [
    { key: "a", kind: "page", label: "Backlog" },
    { key: "b", kind: "page", label: "Agents" },
    { key: "c", kind: "page", label: "Tasks" },
  ];
  assert.deepEqual(labels(filterEntries(entries, "a")), ["Backlog", "Agents", "Tasks"]);
});

// --- search results -------------------------------------------------------

test("each hit type lands on its own route", () => {
  const sections = paletteSections({
    navLinks: NAV,
    themeMode: "system",
    query: "inv",
    results: results({
      tasks: { items: [task()], hasMore: false },
      projects: { items: [project("proj_1", "platform")], hasMore: false },
      agents: {
        items: [{ type: "agent", id: "swe@bundled", name: "swe-agent", namespace: "swe", description: null }],
        hasMore: false,
      },
      backlog: {
        items: [
          {
            type: "backlog",
            id: "bli_1",
            title: "Invoice export",
            status: "todo",
            priority: "P2",
            assignee: "swe",
            projectId: "proj_1",
            projectName: "platform",
          },
        ],
        hasMore: false,
      },
    }),
  });

  const href = (id: string) => section(sections, id)!.entries[0].href;
  assert.equal(href("tasks"), "/tasks/task_1");
  assert.equal(href("projects"), "/projects/proj_1");
  assert.equal(href("agents"), "/agents/swe%40bundled");
  // No per-item backlog route exists, so an item points at its project's list.
  assert.equal(href("backlog"), "/backlog?project=proj_1");
});

test("an untitled task falls back to its request text, then to its command", () => {
  const sections = (t: Partial<ReturnType<typeof task>>) =>
    paletteSections({
      navLinks: [],
      themeMode: "system",
      query: "x",
      results: results({ tasks: { items: [task(t)], hasMore: false } }),
    });

  assert.equal(
    section(sections({ title: null }), "tasks")!.entries[0].label,
    "please add a flow…",
  );
  // Both empty is a real row in this database (titling can fail), and an empty label would
  // render a blank, unreadable line.
  assert.equal(
    section(sections({ title: null, requestText: "" }), "tasks")!.entries[0].label,
    "task",
  );
});

test("a task row carries its status for the badge, not in the description", () => {
  const sections = paletteSections({
    navLinks: [],
    themeMode: "system",
    query: "x",
    results: results({
      tasks: { items: [task({ status: "awaiting_report" })], hasMore: false },
    }),
  });
  const row = section(sections, "tasks")!.entries[0];
  assert.equal(row.status, "awaiting_report");
  // The badge is the only place the status is spelled out, so it can't drift from STATUS_LABEL.
  assert.equal(row.description, "platform");
});

test("a hit whose project row is missing shows no dangling separator", () => {
  // `projectName` is null when the project row is gone — lib/search LEFT joins on purpose.
  const sections = paletteSections({
    navLinks: [],
    themeMode: "system",
    query: "x",
    results: results({
      tasks: { items: [task({ projectName: null })], hasMore: false },
      backlog: {
        items: [
          {
            type: "backlog",
            id: "bli_1",
            title: "Orphan",
            status: "in_progress",
            priority: null,
            assignee: null,
            projectId: "proj_gone",
            projectName: null,
          },
        ],
        hasMore: false,
      },
    }),
  });
  assert.equal(section(sections, "tasks")!.entries[0].description, undefined);
  assert.equal(section(sections, "backlog")!.entries[0].description, "In progress");
});

test("hasMore rides along per section so the cap can be disclosed", () => {
  const sections = paletteSections({
    navLinks: [],
    themeMode: "system",
    query: "x",
    results: results({
      tasks: { items: [task()], hasMore: true },
      projects: { items: [project("proj_1", "platform")], hasMore: false },
    }),
  });
  assert.equal(section(sections, "tasks")!.hasMore, true);
  assert.equal(section(sections, "projects")!.hasMore, false);
});

test("search results are never re-filtered against the query", () => {
  // The endpoint matches a task's *request text* and a backlog item's *body*, neither of
  // which the palette renders. Filtering here would silently drop those rows.
  const sections = paletteSections({
    navLinks: [],
    themeMode: "system",
    query: "invoice",
    results: results({
      tasks: { items: [task({ title: "Nothing alike", requestText: "" })], hasMore: false },
    }),
  });
  assert.equal(section(sections, "tasks")!.entries.length, 1);
});

// --- project actions ------------------------------------------------------

test("matched projects get a New task row, capped", () => {
  const many = Array.from({ length: MAX_PROJECT_ACTIONS + 2 }, (_, i) =>
    project(`proj_${i}`, `app-${i}`),
  );
  const sections = paletteSections({
    navLinks: [],
    themeMode: "system",
    query: "app",
    results: results({ projects: { items: many, hasMore: true } }),
  });

  const actions = section(sections, "actions")!.entries;
  assert.equal(actions.length, MAX_PROJECT_ACTIONS);
  assert.deepEqual(labels(actions), ["New task in app-0", "New task in app-1", "New task in app-2"]);
  assert.equal(actions[0].href, "/projects/proj_0#new-task");
});

test("the Actions section only exists when something is in it", () => {
  // "app" matches no theme row and there are no projects — so no heading.
  const sections = paletteSections({
    navLinks: [],
    themeMode: "system",
    query: "app",
    results: results(),
  });
  assert.equal(section(sections, "actions"), undefined);
});

// --- ordering and the flat list -------------------------------------------

test("sections come back in a fixed order, static first", () => {
  const sections = paletteSections({
    navLinks: NAV,
    themeMode: "system",
    query: "s",
    results: results({
      tasks: { items: [task()], hasMore: false },
      projects: { items: [project("proj_1", "platform")], hasMore: false },
      agents: {
        items: [{ type: "agent", id: "a", name: "swe-agent", namespace: "swe", description: null }],
        hasMore: false,
      },
      backlog: {
        items: [
          {
            type: "backlog",
            id: "b",
            title: "t",
            status: "todo",
            priority: null,
            assignee: null,
            projectId: "proj_1",
            projectName: "platform",
          },
        ],
        hasMore: false,
      },
    }),
  });
  assert.deepEqual(
    sections.map((s) => s.id),
    ["pages", "actions", "projects", "tasks", "backlog", "agents"],
  );
});

test("each section's start index addresses the same row flattenEntries does", () => {
  // The bug this catches is invisible: an off-by-one across groups puts the highlight on one
  // row while Enter opens another. Checked against every row, not just the boundaries.
  const sections = paletteSections({
    navLinks: NAV,
    themeMode: "system",
    query: "s",
    results: results({
      tasks: { items: [task({ id: "task_1" }), task({ id: "task_2" })], hasMore: false },
      projects: { items: [project("proj_1", "platform")], hasMore: false },
    }),
  });
  const flat = flattenEntries(sections);

  assert.ok(flat.length > 4, "fixture should span several sections");
  for (const section of sections) {
    for (const [i, entry] of section.entries.entries()) {
      assert.equal(flat[section.start + i], entry, `${section.id}[${i}]`);
    }
  }
  // The last section must account for the tail of the list — a dropped empty section that
  // still consumed indices would show up here.
  const last = sections[sections.length - 1];
  assert.equal(last.start + last.entries.length, flat.length);
});

test("flattenEntries is the render order the highlight index counts", () => {
  const sections = paletteSections({
    navLinks: [{ href: "/", label: "Dashboard" }],
    themeMode: "system",
    query: "",
    results: null,
  });
  assert.deepEqual(labels(flattenEntries(sections)), [
    "Dashboard",
    "Light theme",
    "Dark theme",
    "System theme",
  ]);
});

// --- highlight movement ---------------------------------------------------

test("moveActive wraps at both ends", () => {
  assert.equal(moveActive(0, 4, 1), 1);
  assert.equal(moveActive(3, 4, 1), 0);
  assert.equal(moveActive(0, 4, -1), 3);
  // Home/End are expressed as jumps, so a delta can exceed the length.
  assert.equal(moveActive(0, 4, 9), 1);
  assert.equal(moveActive(0, 4, -9), 3);
});

test("moveActive answers 0 for an empty list", () => {
  // The caller always needs a usable index — a query with no matches still gets arrow keys.
  assert.equal(moveActive(0, 0, 1), 0);
  assert.equal(moveActive(5, 0, -1), 0);
});

// --- the open store -------------------------------------------------------

test("the open store notifies only on a real change", () => {
  let calls = 0;
  const unsubscribe = subscribePaletteOpen(() => {
    calls += 1;
  });

  assert.equal(getPaletteOpen(), false);
  // Never open during SSR — the palette is a client interaction.
  assert.equal(getServerPaletteOpen(), false);

  openPalette();
  assert.equal(getPaletteOpen(), true);
  assert.equal(calls, 1);

  // A second ⌘K on an already-open palette must not re-render the layout.
  openPalette();
  assert.equal(calls, 1);

  togglePalette();
  assert.equal(getPaletteOpen(), false);
  assert.equal(calls, 2);

  closePalette();
  assert.equal(calls, 2);

  unsubscribe();
  openPalette();
  assert.equal(calls, 2, "an unsubscribed listener stops being called");
  closePalette();
});
