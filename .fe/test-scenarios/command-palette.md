# Manual test scenario — Command palette (⌘K)

_Feature: `components/CommandPalette.tsx` + `lib/command-palette.ts`, mounted once in
`app/(app)/layout.tsx`. Consumes `GET /api/search`._

**Setup:** `pnpm dev`, open http://localhost:3001. Nothing needs seeding — the palette's static
rows (Pages, theme actions) work on an empty install, and the search half reads whatever
projects/backlog items this install already has.

> Note on task results: `GET /api/search` scopes **tasks** to the caller (`ownedBy`), which
> excludes the legacy `user_id IS NULL` rows that make up most of a long-lived dev install. So a
> Tasks section may legitimately never appear here even though `/tasks` looks full. That is the
> documented contract, not a bug — to see task rows, dispatch one task as the current workspace
> first, or stub the endpoint (see the last section).

---

## 1. Opening and closing

| Step | Expect |
|---|---|
| Press **⌘K** (Ctrl+K on Linux/Windows) on any page under the app shell | A dialog opens, titled "Command palette", with the text cursor already in the search field |
| Press **⌘K** again | It closes |
| Press **⌘K**, then **Escape** | It closes |
| Press **⌘K**, then click the backdrop outside the panel | It closes |
| Press **⌘K**, then the **✕** in its header | It closes |
| Click **Search ⌘K** in the sidebar, then press **Escape** | It closes **and focus returns to that button** — Tab should move you to the next sidebar control, not to the top of the page |
| With the palette closed, scroll the page, open it, close it | The page scroll position is unchanged and the page scrolls normally again (the scroll lock released) |

**Guard:** go to `/backlog`, press **Add item**, then press **⌘K** while that dialog is open.
Nothing should happen — you should still be looking at the Add-item dialog, not two stacked
dialogs. (Two `Modal`s means one Escape closing both.)

## 2. The default list (empty query)

Open the palette and type nothing.

- Two sections: **PAGES** (all seven nav entries, in nav order) and **ACTIONS** (Light theme,
  Dark theme, System theme).
- The theme you are currently on has a **✓** at the right of its row.
- The first row is highlighted.
- The footer reads `↑↓ navigate · ↵ open · esc close`.

## 3. Keyboard model

| Key | Expect |
|---|---|
| **↓** | Highlight moves down one row, across section boundaries |
| **↑** from the first row | Wraps to the **last** row |
| **↓** from the last row | Wraps to the **first** row |
| **↑ / ↓** held | Highlight scrolls the list to keep itself visible |
| **Home / End** | Move the **text caret** in the query field — they must *not* move the highlight (this is an editable combobox) |
| **Tab** | Moves between the search field and the ✕ only, cycling — never into the result rows |
| **Enter** | Activates the highlighted row |
| **Enter** with no matches | Nothing happens; the palette stays open |
| Mouse over a row | That row becomes the highlighted one |
| Click a row | Same as Enter on it |

## 4. Searching

Type **two or more characters** of a project name (e.g. `con` for "Control Center").

- Results appear after a short pause, not on every keystroke (150ms debounce), with a spinner in
  the right of the search field while a request is out.
- Sections appear in this order, and **any section with no rows is absent entirely** (no empty
  headings): Pages → Actions → Projects → Tasks → Backlog → Agents.
- A matched project produces **two** rows: `New task in <project>` under ACTIONS and the project
  itself under PROJECTS.
- A project row's second line is its **path, in the mono font**.
- A backlog row's second line is `<project> · <status>`.
- An agent row's second line is `/<namespace>`.
- A group the server capped says **"more matches"** at the right of its heading.

**One character** (e.g. just `c`): no rows from the server, and the message
*"Keep typing to search tasks, projects, agents and backlog items."*

**Nonsense** (e.g. `zzzqqq`): *"No matches for “zzzqqq”."*

**Clear the field**: back to the default Pages + Actions list — importantly, type `con`, clear
it, then type `zzz`: you must **not** briefly see the `con` results under `zzz`.

## 5. Activating things

| Row | Expect |
|---|---|
| A **page** row | Navigates to that page; palette closes |
| A **project** row | Lands on `/projects/<id>` |
| A **task** row | Lands on `/tasks/<id>` |
| A **backlog** row | Lands on `/backlog?project=<id>` (there is no per-item route) |
| An **agent** row | Lands on `/agents/<id>` |
| **New task in *project*** | Lands on that project page **scrolled to the "New task" card** |

**The one that used to be broken** — do this exactly: open a project page, use the palette's
"New task in *this project*" once (URL now ends `#new-task`), scroll to the bottom of the page,
then use the same row again. The page must scroll **back to the New task card**. Pushing a URL
you are already on is a no-op, so this silently did nothing before.
| A **theme** row | The whole app switches theme immediately, the palette closes, and **the page does not navigate** — you stay where you were. Reopen the palette and the ✓ has moved to the row you picked. |

## 6. Responsive

| Width | Expect |
|---|---|
| **320px** | The palette fills the width minus the page gutter, anchored near the top. Task rows show **no status badge** (there isn't room) but titles truncate with an ellipsis rather than wrapping. **No horizontal page scroll.** |
| **390px** | Same |
| **≥640px** | Task rows now show their `StatusBadge` on the right |
| **≥768px** | Panel is a centred column, `max-w-xl`, ~10vh from the top |

**Mobile top bar (below `md`):** there is a **magnifier icon** between the brand and the theme
icon — this is the only way to open the palette on a phone. At 320px the bar must not overflow;
the brand truncates ("Agent Con…") and the controls keep their size. Check this **while a task
is running**, when the activity pill is also in that row.

**Sidebar (≥`md`):** the trigger is a field-shaped `Search  ⌘K` button above "NAVIGATE".
Collapse the sidebar (**Collapse** at the bottom) and it becomes a magnifier icon in the rail.

## 7. Dark / light

Do sections 2 and 4 in both themes (the sidebar's theme control, or the palette's own theme
rows). Check specifically:

- The panel is an **opaque** surface in both — no page content showing through it.
- The highlighted row is distinguishable from the unhighlighted ones in both.
- Section headings, second lines and footer hints are all legible (nothing at `fg-ghost`).
- Status badges keep their tone meaning (amber = waiting/running, red = failed, green = done).

## 8. Accessibility

- **Screen reader:** the dialog announces as "Command palette", the field as a combobox, and
  moving with ↑↓ announces each row including its second line and (on a task row) its status —
  **at every width**, including 320px where the badge is invisible.
- The current theme row announces as e.g. "System theme (current)".
- After each search settles, a polite live region announces the result count ("7 results").
- A capped group announces as e.g. "Tasks more matches".
- **Keyboard only, no mouse:** you can open the palette, reach every row, activate one, and get
  focus back to where you started.
- `prefers-reduced-motion: reduce` — the spinner and transitions collapse (global rule); nothing
  in the palette animates on its own.

## 9. Failure

Break the endpoint (e.g. DevTools → block `/api/search`, or stop the dev server's DB) and type a
query:

- A red alert bar appears under the search field with the reason.
- The **static rows still work** — Pages and the theme actions are unaffected, and Enter on them
  still navigates.
- Clearing the field clears the error.

---

### Exercising task rows without touching the live database

Task rows need tasks owned by the current workspace. Rather than seeding the live DB (it has
corrupted twice — see the root memory), stub the endpoint in the page. With DevTools open on any
app page:

```js
const real = window.fetch;
window.fetch = (i, n) => {
  const u = typeof i === "string" ? i : i.url;
  if (u?.includes("/api/search")) {
    return Promise.resolve(new Response(JSON.stringify({
      q: new URL(u, location.origin).searchParams.get("q"), limit: 5, tooShort: false,
      tasks: { items: [
        { type:"task", id:"task_a", title:"Add invoice approval flow to the billing screen", requestText:"", command:"task", status:"awaiting_report", projectId:"p1", projectName:"Control Center", createdAt:new Date().toISOString() },
        { type:"task", id:"task_b", title:null, requestText:"please tidy up the header spacing on mobile", command:"fix", status:"running", projectId:"p1", projectName:"Award Maven", createdAt:new Date().toISOString() },
        { type:"task", id:"task_c", title:null, requestText:"", command:"audit", status:"failed", projectId:"p1", projectName:null, createdAt:new Date().toISOString() },
      ], hasMore: true },
      projects: { items: [], hasMore: false },
      agents: { items: [], hasMore: false },
      backlog: { items: [], hasMore: false },
    }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  return real(i, n);
};
```

Then ⌘K and type anything. This also covers three fallbacks worth seeing: an **untitled** task
shows its request text, a task with **neither** shows its command (`audit`), and a task whose
project row is missing shows **no dangling separator**.
