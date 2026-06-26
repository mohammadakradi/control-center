# Test scenario — Shared searchable Select component

**Change:** Introduced a bespoke, shareable searchable `Select`/combobox at
`components/ui/select.tsx` and replaced every native `<select>` with it:
- `NewTaskForm` — agent, command, and model selectors
- `GitControls` — branch switcher (search enabled)

Run the app with `pnpm dev` (Docker) and open http://localhost:3000.

## 1. New-task form selectors (`/projects/<id>` → New task card)
1. Click the **agent** select (`/fe`, `/swe`, …). A popover opens listing agents in mono.
2. Click the **command** select. Popover lists commands; each shows its description as a
   muted subline. The selected command shows a sky `Check`. Pick one → it closes and the
   trigger label updates; the full description still renders below the row.
3. Click the **model** select (Auto / Sonnet 4.6 / Opus 4.8). Pick one → label updates.
4. Expected: no native OS dropdown appears anywhere; all three use the custom popover.

## 2. Branch switcher search (`GitControls`, on a repo with several branches)
1. Click the branch select. A **Search** field appears at the top (auto-on past 7 options;
   forced on here) and is auto-focused.
2. Type part of a branch name → the list filters live (matches on label/value). Clearing the
   field restores the full list. A no-match query shows "No matches".
3. Pick a branch → it triggers a checkout (page refreshes). While a Pull/Push is in progress
   the select is disabled and selecting an option does nothing (guarded).

## 3. Keyboard & accessibility
1. **Tab** to a select trigger. Press **↓**, **Enter**, or **Space** → popover opens.
2. With search present: type to filter; **↑/↓** move the highlight; **Enter** selects;
   **Esc** closes and returns focus to the trigger; **Tab** closes.
3. Without search (model/agent): **↑/↓** highlight (the trigger exposes the highlighted
   option via `aria-activedescendant`), **Space**/**Enter** select.
4. Verify roles: select-only triggers expose `role="combobox"` + `aria-haspopup="listbox"`;
   in search mode the search input is the combobox and the trigger is a plain button. The
   list is `role="listbox"` with an `aria-label`; options are `role="option"` with
   `aria-selected`.
5. Click outside the popover → it closes.

## 4. Dark mode (only mode)
- Confirm trigger/popover use neutral-900 surfaces, neutral-700 borders, sky focus border,
  and the selected option is sky-300 + `Check`. No light-mode artifacts.

## 5. Responsive (~375px and desktop)
1. At 375px: the new-task selectors wrap onto multiple lines (flex-wrap) without horizontal
   page overflow; long branch names truncate in the trigger.
2. The popover has a `min-w-48` floor, `w-full` to the trigger, and scrolls (`max-h`) when
   the option list is long.
3. Desktop: popover aligns to the trigger's left edge directly beneath it.

## Known non-blocking notes (out of scope)
- Popover always opens downward (no viewport-edge flip) — matches scope; revisit if it clips.
- Focus indicator is a 1px sky border (matches existing inputs); a `focus-visible` ring is a
  future polish item across all form controls.
