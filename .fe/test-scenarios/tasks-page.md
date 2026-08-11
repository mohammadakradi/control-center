# Test scenario — The Tasks page (all tasks, grouped by project)

**Change:** a **Tasks** entry in the primary nav opens `/tasks`, a single place showing every
task *you* dispatched, grouped by the project it ran in, with a project filter. Previously the
only way to review work across projects was to visit each project detail page in turn.

- `app/(app)/tasks/page.tsx` — **new**; the page. Sits beside the existing `[id]/` route.
- `components/ProjectFilterNav.tsx` — **new**; the wrapping pill filter (links, URL state).
- `components/nav-links.tsx` — the **Tasks** entry (`ListChecks`). Sidebar + mobile tab bar
  both consume this list, so both gained it; the tab bar is now at **six** tabs.
- `components/ui-cards.tsx` — `ViewAll` moved here from `app/(app)/page.tsx` so the new page
  could reuse it. Pure move, no visual change.
- `app/(app)/page.tsx` — uses the shared `ViewAll`; **Recent activity** gained a "View all"
  link to `/tasks` (it only ever shows 8).

Rows themselves are the shared `TaskList` from the previous task — this page adds no new row
markup, so anything about row anatomy is covered by `.fe/test-scenarios/shared-task-list.md`.

## 1. The point of the change
1. Open the app. The nav (sidebar on desktop, bottom bar on mobile) now has **Tasks** between
   Projects and Usage.
2. Click it → `/tasks`. You get one card per project that has tasks, most recently active
   project first, each headed by the project name with a task count and an **Open project**
   link.
3. The page description reads `N tasks across M projects.`
4. Click any row → the task view (`/tasks/<id>`), same as from any other list.
5. **The Tasks nav entry stays highlighted on `/tasks/<id>`** — the detail page lives under
   the same prefix, so it belongs to Tasks.
6. Go back to `/` (Dashboard) → **Recent activity** now has a **View all** link in its header
   that lands on `/tasks`.

## 2. The project filter
1. On `/tasks`, the pills above the groups read **All projects** then one per project, each
   with its task count. **All projects** is selected by default and the URL has no query param.
2. Click a project pill → URL becomes `/tasks?project=<id>`, only that project's card remains,
   and the pill is visibly selected.
3. **Back button** returns to the previous filter, and a filtered URL is bookmarkable —
   paste `/tasks?project=<id>` into a fresh tab and you get the same view. (The filter is
   plain links; there is no client JavaScript on this page at all.)
4. A project with **no tasks of yours** is not offered as a pill. Add a fresh project and
   don't run anything in it — it appears on `/projects` but not in this filter, because
   filtering to it could only ever produce an empty list.
5. With only one project in the filter, the pill row **doesn't render at all** — there's no
   choice to make.

## 3. The per-group cap and its disclosure
1. Find (or create) a project with more than 8 of your tasks. On the unfiltered `/tasks`, its
   card shows the **8 most recent**, then a line reading
   `N older tasks in this project — show all`.
2. Click **show all** → filters to that project and now shows **all** of them, with no cap
   line. That's deliberate: capping a project you explicitly asked for is just an obstacle,
   and project detail is uncapped too.
3. The count in the card header is always the **true total** for the project, not the number
   of rows displayed. With 14 tasks it reads "14 tasks" while showing 8.
4. Check the pluralization at exactly 1: a project with a single task reads "1 task", and a
   cap line hiding a single task reads "1 older task in this project". (`.fe/notes.md`
   documents a JSX gotcha where `{expr}` next to prose eats the space — so look for
   "1 older task", never "1older task".)

## 4. Empty and error states
1. **No tasks at all** (a fresh install, or a brand-new account): the page shows the dashed
   `EmptyState` — "No tasks yet" / "Open a project and dispatch one…" — and no filter pills.
   The description drops the counts and reads "Every task you dispatch, grouped by the project
   it ran in."
2. **A stale filter**: hand-edit the URL to `/tasks?project=deleted-or-nonsense`. You get
   "No tasks in that project" with a **Show all tasks** link back — *not* a 500, and *not* a
   silent fallback to every project (which would look like the filter was broken). The filter
   pills stay on screen so you can recover with one click.
3. **A malformed param** *does* fall back silently, because there's nothing to explain:
   `/tasks?project=` (empty) and `/tasks?project=a&project=b` (repeated, arrives as an array)
   both render the normal unfiltered page. This matches `/usage`'s rule for `?range=`.

## 5. Privacy — the one that matters
Tasks are private per owner while projects and agents are deliberately shared, and
`lib/task-access.ts` is the only thing enforcing that.

1. Sign in as a second account (`/signup`) and dispatch a task in a project the first account
   also uses.
2. Sign back in as the first account and open `/tasks`. The other account's task must **not**
   appear — not as a row, not in a project's count, and not as a filter pill for a project
   where you personally have no tasks.
3. Signed out (the local workspace), the same holds: you see only `user_local`'s tasks.
4. Take a task id belonging to the other account and load `/tasks?project=<that project>`.
   It must not surface the task, and the count must not include it.

## 6. Responsive
1. **375px** — groups stack full width; there is **no horizontal page scroll** (drag right to
   confirm). Filter pills wrap onto multiple lines. Task rows drop cost and time-ago, keeping
   command · name · status.
2. A **very long project name** truncates with an ellipsis inside its pill and inside the card
   heading rather than widening the page.
3. **Mobile bottom tab bar now has six tabs.** At ~390px and up all six labels fit. At **320px**
   (iPhone SE 1st gen) "Dashboard", "Projects" and "Settings" ellipsize — this is accepted and
   documented: the icons carry recognition and the full label is still each link's accessible
   name. What must NOT happen is the bar scrolling sideways or a tab wrapping to two lines.
4. **768px / 1280px** — sidebar returns; groups remain single-column full-width cards. Collapse
   the sidebar to the icon rail and confirm the Tasks icon is present and highlights correctly.

## 7. Dark mode + a11y
1. Toggle **light / dark / system**. Filter pills, card headers, the cap-disclosure line and
   both empty states all follow the theme — no element stays light-on-light or dark-on-dark.
   The selected pill must stay visibly distinct from the unselected ones in **both** themes.
2. **Keyboard**: Tab through the page. Every pill and every task row takes focus with a visible
   ring, in reading order. Enter on a pill filters; Enter on a row opens the task.
3. **Screen reader**: the pill row announces as a navigation landmark named "Filter tasks by
   project"; the selected pill announces as current. Each pill announces its name *and* its
   count in words ("platform, 14 tasks") — the bare number beside the label is hidden from the
   reader precisely because "platform 14" sounds like part of the name.
4. Navigate by heading: `<h1>` Tasks, then one `<h2>` per project. No skipped levels.

## Verified during the build
Rendered against a seeded throwaway database (`PLATFORM_DB=/tmp/x.db` + `next start`, per
`.fe/notes.md`) with 18 tasks across 3 projects plus one project with none, one untitled task,
one long project name, and **one task owned by a second user**. Confirmed: correct grouping and
ordering, the 8-row cap with a "6 older tasks" disclosure, the uncapped filtered view (14 rows),
both empty states, the array/empty-param fallbacks, `aria-current` on the nav entry from both
`/tasks` and `/tasks/<id>`, and that the second user's task appears nowhere in the markup.
Not verified by machine: actual pixel rendering, dark mode, and keyboard/screen-reader
behaviour — there is no browser or DOM test tooling in this project, so sections 6 and 7 are
genuinely manual.
