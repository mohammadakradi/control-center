# Test scenario — Project detail: no horizontal scroll + block extraction

_Task: fix horizontal scroll on the project detail page; extract its blocks into components._

## What changed (user-visible)
- The **project detail page** (`/projects/<id>`) no longer scrolls horizontally on
  narrow viewports. Root cause: the main grid had no `grid-cols-1` base, so below `lg`
  it used a single implicit max-content column that overflowed the viewport.
- The **New task**, **At a glance**, **Source control**, and **Task history** blocks
  are now dedicated components (`AtAGlance`, `SourceControl`, `TaskHistory`) built on a
  new reusable `CardSection` primitive. No visual redesign — same content, same tokens.

## Setup
1. `pnpm dev` (starts Next.js + runner).
2. Open `http://localhost:3000/projects` and click into a project that has:
   - a git branch with an upstream (long branch name ideal, e.g. `feat/multi-agent-project-ui`),
   - some uncommitted changes,
   - at least a few tasks in history.
3. Also test a **workspace** project (multiple member repos) if available.

## Checks

### Horizontal overflow (the fix)
- [ ] Resize the browser to **375px** wide (DevTools device toolbar → iPhone SE).
- [ ] **No horizontal scrollbar** appears; the page does not scroll sideways.
- [ ] DevTools console: `document.documentElement.scrollWidth === document.documentElement.clientWidth` → **true**.
- [ ] Repeat at **320px**, **414px**, **768px**, and **1024px** — no horizontal scroll at any width.

### Layout / responsiveness
- [ ] **< lg (mobile/tablet):** all four blocks stack in a single full-width column.
- [ ] **≥ lg (1024px+):** New task spans full width; At a glance + Source control sit side by side; Task history spans full width.
- [ ] **New task:** the agent / command / model selects wrap onto multiple lines at 375px instead of overflowing.
- [ ] **At a glance:** the two stat tiles stay 2-up; a long upstream branch ref in the "Tracking …" fact wraps (`break-all`) instead of overflowing.
- [ ] **Source control (single repo):** branch switcher + Pull/Push wrap; the changes file list scrolls *inside* its box (`max-h-72`), not the page.
- [ ] **Source control (workspace):** repo tabs wrap; switching tabs works.
- [ ] **Task history:** rows wrap; long request text truncates with `…`; the relative time is hidden below `sm`; status badge stays on the row.

### Behavior preservation
- [ ] Dispatching a task from **New task** still navigates to the task live view.
- [ ] Branch switch / Pull / Push in **Source control** still work.
- [ ] Clicking a changed file still opens the diff modal.
- [ ] Each **Task history** row links to `/tasks/<id>` and shows the correct `/namespace:command` label.
- [ ] Empty states: a project with no tasks shows "No tasks yet."; a non-git project shows no Source control card.

### Dark mode
- [ ] Dark-only is preserved — backgrounds, borders, and text match the rest of the app (no light flashes, no `dark:` artifacts).

### Accessibility
- [ ] Heading order is h1 (project name) → h2 (each card title); no skipped levels.
- [ ] All controls (selects, buttons, history links) are reachable and operable via keyboard (Tab / Enter).

## Notes
- No automated test suite exists in this project; this is a manual scenario.
- No headless browser is installed in the build environment, so the responsive checks
  above were reasoned from CSS semantics + verified via `pnpm lint` and `pnpm build`
  (both clean). Please run the 375px overflow check in a real browser to confirm.
