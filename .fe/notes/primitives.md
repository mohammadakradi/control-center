# primitives

The shared primitives — check here before hand-rolling a field, button, modal, select, card or task row.

<!-- Split out of a single 79 KB `.fe/notes.md` on 2026-08-24, which was read in full at the start of every request (frontend rule 10). Entries are verbatim; only this header is new. -->

## One task row for the whole app — `components/TaskList.tsx` (2026-08-11)
Task rows had drifted into three implementations, and two of them rendered `requestText`
while `tasks.title` (generated at dispatch) sat unused — so the same history read as prose on
the dashboard and as an intent on project detail. `TaskList` is now the only task row;
`TaskHistory` is a `CardSection` wrapper around it. **Add a task list by composing
`CardSection` + `TaskList`, never by writing row markup.** The fallback chain lives in
`taskDisplayTitle()` (`lib/ui.ts`, unit-tested in `lib/ui.test.ts`) precisely because
inlining it is what let two call sites drop the title; the task detail `<h1>` uses it too.
The card shell stays out of `TaskList` — the three hosts head their cards differently
("Task history" + count, "Recent activity", "Recent runs" + count).

Two things reviewers have asked about, so they're settled here: **`v<version>` shows on every
row, including agent detail** where the agent is the same for all of them — because
`tasks.agent_version` is a per-run *snapshot* and an agent can be updated between runs, so the
column genuinely varies down the list. And **`UsageSummaryCard`'s "Most expensive runs" is
deliberately not a `TaskList`**: it reads a narrow `TaskSpend` projection (no status, no agent,
no tokens), is ranked by cost rather than time, and leads with the cost figure. It shares
`taskDisplayTitle()` so an untitled task is named the same way, and nothing else.

## One field primitive, one button primitive — check before hand-rolling (2026-08-13)
`components/ui/input.tsx` now carries `size` (`sm|md|lg`) and `tone` (`default|danger`), which
was the whole reason five inputs had been hand-rolled: the defaults didn't fit, so each call
site rebuilt the treatment and drifted its focus ring (`focus-visible:ring-ring/40` against the
canonical `focus:ring-accent/30`). Extending the primitive was ~15 lines and deleted all five
copies. Same for `Button`, which gained a `warn` variant and absorbed six more hand-rolled
treatments including `GitControls`' local `syncBtn` class string.

Two gotchas from doing it:
- **`fieldClasses` is a function now**, not a string (`fieldClasses("md", "default", extra)`),
  matching `buttonClasses()`. Its one existing caller (`AddBacklogItem`'s textarea) was updated.
- **The field is `w-full`, so a fixed width needs `max-w-*`, not `w-*`.** Two width utilities of
  the same specificity race in the generated CSS and Tailwind's output order — not the class
  attribute's order — decides. `DataSettings`' UNINSTALL field is `max-w-44` for this reason.
- `Button` spreads `{...rest}` *after* its own `type="button"`, so `type="submit"` still works
  when you need a real submit button (`GitControls`' Create).

**Two deliberate visual side effects of adopting the primitive** — recorded so neither gets
rediscovered later as a regression:
- `ProjectName`'s rename-in-place field went from `bg-sunken` to the primitive's `bg-surface-2`.
  Kept: `surface-2` sits further from `canvas` than `sunken` does in *both* themes, so the
  field reads more clearly as editable than the thing it replaced.
- `AddProjectForm`'s field went from `border-line` to `border-line-strong`. That's the
  design system's own stated rule for inputs (`border-line-strong`), so the migration
  *removed* drift rather than introducing it.

## Component library: bespoke only
No shadcn/ui, Radix, or MUI. All components are handbuilt. Reuse `Chip`, `Tile`, `Fact`, `card`, `CardSection`, `PageHeader`, `EmptyState` (from `ui-cards.tsx`), `StatusBadge`, and the `components/ui/` primitives before writing new ones.

## Buttons and modals are primitives — don't hand-roll them
- **`components/ui/button.tsx`** — `Button` / `buttonClasses()` with `variant` (`primary`, `success`, `secondary`, `ghost`, `danger`, `accent`) and `size` (`sm`, `md`, `icon`), plus a `loading` prop that renders the spinner, disables, and sets `aria-busy`. This replaced **11 drifted button treatments**; don't reintroduce a bespoke button.
  - The `primary`/`success` gradients are deliberately dark-stopped (`sky-700→blue-600`, `emerald-700→emerald-800`) so white text clears AA against the **lightest** stop. Don't lighten them.
- **`components/ui/modal.tsx`** — `Modal` provides `role="dialog"`, `aria-modal`, an accessible name, Escape-to-close, a focus trap, focus restore, and body-scroll lock. `DiffModal`/`FileModal` build on it; don't re-implement an overlay.

## Agent avatar images
Agent avatars live in `public/` as `<namespace>-agent.png` (e.g. `fe-agent.png`, `swe-agent.png`). The `Avatar` component (`components/AgentAvatar.tsx`) takes a `namespace: string` prop — NOT `agentId`. The `AgentContributors` component also takes `namespaces: string[]` not `agentIds`.

## TaskLiveView requires all 5 props
`TaskLiveView` needs `taskId`, `runnerUrl`, `initialStatus`, `projectId`, and `agentId` — don't pass fewer; the component uses all of them for SSE connection and action routing.

## CardSection for card + header blocks
Use `CardSection` (`components/ui-cards.tsx`) instead of hand-rolling `<section className={card}><div header><h2>…</h2></div>`. Props: `title`, `right?` (header right slot), `className?`. It carries `min-w-0` so it shrinks inside grid/flex parents. The project detail page's four blocks (`AtAGlance`, `SourceControl`, `TaskHistory`, New task) all build on it.

## Shared `Select` lives in `components/ui/select.tsx`
The base, **searchable** select/combobox is `components/ui/select.tsx` (the first component in a new `components/ui/` base-primitive folder). It replaces every native `<select>` — `NewTaskForm` (agent/command/model) and `GitControls` (branch switcher, search-on). Options are passed as a `{value,label,description?,icon?}[]` array (not `<option>` children). `className` controls width/layout (root is `relative inline-flex`); pass `w-full` to fill a flex parent, `min-w-48` for a floor. Search auto-enables past 7 options. **Don't** reach for a native `<select>` or hand-roll a wrapper again.

## RunDuration uses `createdAt`, not `startedAt`
The prop is `createdAt: number` (Unix ms), `endedAt: number | null`, `active: boolean`. The `active` flag controls whether the timer ticks.
