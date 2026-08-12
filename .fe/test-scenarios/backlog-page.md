# Test scenario: Backlog nav page and per-project backlog UI

_Task: a **Backlog** entry in the primary nav opens `/backlog` — pick a project, read its planned
work, change an item's status, add one by hand, and run one as a task · 2026-08-12_

## Setup / preconditions
- The dev stack running: `pnpm dev` → <http://localhost:3001>
- At least **two registered projects**, so the project switcher appears at all (it hides itself
  when there's only one project to choose between). Add them under **Projects → Add project**.
- One of those projects should be a repo the pm agent has planned into — i.e. it has
  `.pm/tasks/<timestamp>/NN-something.md` files. **This repo itself works**: register
  `/Users/moh/Dev/agent/platform`.
- To run an item you need an Anthropic token saved under **Settings**. Without one the page
  shows the amber "Add your Anthropic token" bar and Run fails with a link to Settings — worth
  seeing once, deliberately.

## Happy path
1. Open <http://localhost:3001> and look at the left sidebar.
   - **Expected:** a new **Backlog** entry (clipboard icon) between *Projects* and *Tasks*.
2. Click **Backlog**.
   - **Expected:** the Backlog entry is highlighted (accent bar + accent icon); the page shows
     the first project's planned work. The heading reads e.g. *"18 open items in Agent Platform,
     and 2 closed."*
   - **Expected:** every registered project appears as a pill below the header; the current one
     is filled in. Projects with open items show a count; ones with none show just a name.
3. Find an item that came from a spec file.
   - **Expected:** a coloured dot, the title, a priority chip (e.g. `P1`), the agent it's for
     (`/swe`, `/fe`), the spec's path in mono (`.pm/tasks/…/03-….md`), and a truncated preview
     of the spec that **starts at the prose, not at `--- title:`**.
4. Click **Show more** on that item.
   - **Expected:** the full spec expands, rendered as markdown, in a scrollable box. **Show
     less** collapses it again.
5. Change that item's status dropdown from **To do** to **In progress**.
   - **Expected:** the control shows the new value within a moment, the dot turns amber, and the
     item moves from the *Open* section only when set to *Done* or *Cancelled* (which move it
     down into **Done & cancelled**).
6. Press **Run** on any open item.
   - **Expected:** the button shows *Starting…*, then the browser navigates to `/tasks/<id>` and
     the task streams live. The agent is the one named on the item (`/fe` or `/swe`).
7. Go back to **Backlog**.
   - **Expected:** that item now reads **In progress**, shows **Last run** with the task's status
     badge and an **Open task** link, and its button reads **Running** and is disabled.
8. When that task finishes successfully, reload `/backlog`.
   - **Expected:** the item has moved to **Done & cancelled**, and the button now reads
     **Re-run**.
9. Click **Add item** (top right), fill in a title, a description and pick **/fe**, then
   **Add item**.
   - **Expected:** the dialog closes and the new item appears in the *Open* section with no spec
     path (it isn't file-backed). Running it hands the description to the agent.
10. Open **Projects → <the same project>**.
    - **Expected:** a **Backlog** button next to *Rescan* / *Remove*, carrying the count of open
      items, linking back to that project's backlog.

## Responsive
1. Resize to **375px** (device toolbar, iPhone SE/12).
   - **Expected:** the bottom tab bar shows **seven icons with no labels**, evenly spaced, not
     scrolling sideways; the Backlog tab is the clipboard. Tapping it still navigates, and the
     active tab is accent-coloured.
   - **Expected:** each backlog row stacks — title and metadata first, then the status dropdown
     and Run button on their own full-width line. No horizontal page scroll at any point (drag
     the page sideways to confirm).
2. Resize to **640px** (the `sm` breakpoint).
   - **Expected:** the tab labels come back under the icons; the row controls move back beside
     the text.
3. Resize to **≥1280px**.
   - **Expected:** sidebar nav, full-width cards, one row per item, controls right-aligned.

## Dark mode
1. Toggle the theme control in the sidebar footer through **Light → Dark → System**.
   - **Expected:** cards, the status dropdown, the "agent-filed" chip and the amber warnings bar
     all switch cleanly; no white boxes, no washed-out text. The status dots stay legible
     against the card in both themes.

## Accessibility
1. From the top of `/backlog`, navigate with **Tab only**.
   - **Expected:** every project pill, the *Add item* button, each **Show more**, each status
     dropdown and each **Run** are reachable in reading order, each with a visible focus ring.
2. On a status dropdown press **Enter** (or **↓**) to open, **↑/↓** to move, **Enter** to pick,
   **Esc** to dismiss.
   - **Expected:** the menu opens, the current status is highlighted, Enter saves, Esc closes and
     returns focus to the dropdown — never to the top of the page.
3. Open **Add item** and press **Esc**; reopen it and press **Tab** repeatedly.
   - **Expected:** Esc closes the dialog and focus returns to the *Add item* button; Tab cycles
     **within** the dialog only.
4. With a screen reader (VoiceOver: ⌘F5), move over the mobile tab bar at 375px and over a status
   dropdown.
   - **Expected:** the tabs announce "Dashboard", "Backlog", … even though no text is visible;
     the dropdown announces "Status — <item title>"; the project pills announce ", 18 open items"
     rather than a bare number.
5. Check the status colours.
   - **Expected:** no state is signalled by colour alone — the word ("To do", "In progress",
     "Done", "Cancelled") is always in the control next to the dot.

## Edge / failure cases
1. Visit `/backlog?project=does-not-exist`.
   - **Expected:** the project pills still render, plus *"That project isn't registered any
     more"* and a link back — not an error page and not a silent switch to another project.
2. Open the backlog of a project with no planned work.
   - **Expected:** *"Nothing planned yet"* with a hint naming `.pm/tasks/`, and the *Add item*
     button still available.
3. In the project folder, add a symlink inside a `.pm/tasks/<request>/` folder
   (`ln -s ~/.ssh/id_rsa .pm/tasks/<request>/99-evil.md`) and reload `/backlog`.
   - **Expected:** an amber bar saying an entry was skipped. **The file's contents must not
     appear anywhere on the page.** Delete the symlink afterwards.
4. Sign in as a second account (**Sign in → create account**), then open `/backlog`.
   - **Expected:** the same items — the backlog is shared per project — but an item run by the
     other account shows its status badge with **no "Open task" link**, because that transcript
     isn't yours.
5. Press **Run** twice quickly on one item.
   - **Expected:** one task. The second press is refused with *"This item is already running as
     task …"* and an **Open it** link, not a second session.
6. With no Anthropic token saved, press **Run**.
   - **Expected:** a red message under the row with an **Open Settings** link; no task is created
     and the spinner stops.
7. A project with more than 50 open items.
   - **Expected:** 50 rows and a line reading *"N more items in this section — show all"*; the
     link renders all of them. Nothing is dropped silently.

## What success looks like
Backlog is a first-class destination: the pm agent's specs show up on their own, you can see at a
glance what's planned versus finished, drive an item to a real task in one click, and get back to
the run that came from it. It looks like the rest of the app in both themes, all seven nav tabs
survive a 320px phone, and every control works from the keyboard.
