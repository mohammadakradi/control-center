# Test scenario: design-audit remediation — getting-started checklist, contrast, shared field

_Task: fixed the 2026-08-13 design/UX audit — 10 sub-AA `fg-ghost` text uses, 5 hand-rolled
inputs folded into the shared `Input`, 6 hand-rolled buttons folded into `Button`, and a new
first-run "Get started" checklist on the dashboard · 2026-08-13_

## Setup / preconditions
- Docker dev stack: `pnpm dev` → <http://localhost:3001> (or an install on :7373).
- You need to be able to see the dashboard **with and without** a saved Anthropic token —
  Settings → Anthropic token is where you add/remove one.
- At least one registered project makes steps 2–3 of the checklist meaningful.

## Happy path — the new "Get started" card

1. Open <http://localhost:3001/> with **no Anthropic token saved**.
   - **Expected:** a "Get started" card directly under the page header, before the stat tiles.
     Header row reads **Get started** on the left and **"0 of 3 done"** (or 1/2 of 3, per your
     state) on the right.
   - **Expected:** an intro paragraph defining all three nouns in one place — *agent* =
     installed Claude Code plugin, *project* = folder on this device, *task* = one agent
     command run against a project — with those three words in a heavier weight.
   - **Expected:** three numbered rows: **Add your Anthropic token**, **Add a project**,
     **Run your first task**, each with a one-line explainer beneath it.

2. Look at the **token** row specifically.
   - **Expected:** it is **amber/warn-toned** (amber background, amber border, amber text,
     amber key icon) — this is the urgency the old standalone token banner carried.
   - **Expected:** exactly **one** button on the whole card, "Open Settings", on that row.
     Rows 2 and 3 have no button while row 1 is outstanding.
   - **Expected:** the old amber `TokenNudge` banner is **gone from the dashboard** — the
     message must appear once, not twice.

3. Click **Open Settings** → save a valid token → return to the dashboard.
   - **Expected:** the token row is now **green with a checkmark**, its title greys out, the
     counter increments, and the next incomplete row becomes the highlighted one (stronger
     border + a filled `surface-2` background) and gains the only button.

4. Satisfy all three steps (token saved, ≥1 project, ≥1 task you dispatched).
   - **Expected:** the "Get started" card **disappears entirely** from the dashboard. It must
     not leave a gap, an empty card, or a stray heading.

5. Go to <http://localhost:3001/projects/…> (any project) and <http://localhost:3001/backlog>
   with **no token saved**.
   - **Expected:** the original amber `TokenNudge` banner still appears on **those** pages,
     unchanged. Only the dashboard swapped it for the checklist.

## Happy path — vocabulary copy

6. Visit `/agents`, `/projects`, `/tasks` and read the grey line under each page title.
   - **Expected:** `/agents` — "An agent is an installed Claude Code plugin…";
     `/projects` — "A project is a folder on this device that agents can work in…";
     `/tasks` (only when you have no tasks) — "A task is one agent command run against a
     project…". Each page now defines its own noun.

## Happy path — the shared field and buttons

7. `/projects` → the **Project folder** input, and its **Browse…** modal → the
   "go to path" bar at the top of the picker.
   - **Expected:** both are the standard field — same rounded border, same `surface-2` fill,
     same **blue** focus ring. The picker's bar is the smaller/denser variant.
   - **Expected:** focusing either shows a blue ring, *not* the slightly different ring these
     used to have. Type a path and press **Enter** in the picker's bar — it must **jump to
     that folder**, never submit the Add-project form behind it.

8. Project detail → click the **pencil** next to the project name.
   - **Expected:** the name turns into an input that is **the same visual size as the heading
     it replaced** (the title must not visibly shrink or jump). It autofocuses.
   - **Expected:** Enter saves, Escape cancels, and the name is capped at 100 characters.

9. Project detail → **Source control** card.
   - **Expected:** **New branch**, **Pull** and **Push** now look like the app's standard
     secondary buttons (same height/padding/hover as e.g. "Rescan" in the page header).
   - Click **Pull** (or **Push**) on a project with a remote.
   - **Expected:** a spinner appears in the button, the button set disables while it runs, and
     the git output appears below. No double-fire on a fast double-click.
   - Click **New branch**, type a name, click **Create**.
   - **Expected:** the branch is actually created — the Create button must still submit its
     form.

10. Settings → **Data** → the uninstall section.
    - **Expected:** the "Type UNINSTALL" field is the standard field but with a **red/danger
      focus** border, and stays its original narrow width (it must not stretch to full width).
    - **Expected:** the Uninstall button stays disabled until you type exactly `UNINSTALL`.

## Happy path — the backlog Run button reports state

11. Open <http://localhost:3001/backlog>, pick a project with items.
    - **Expected:** items you haven't run show a blue-tinted **Run**; an item with a previous
      run shows **Re-run**; an item whose task is live shows a disabled **Running**.
12. Set any item's status control to **Done**.
    - **Expected:** its Run button becomes a **green, disabled "Done"** with a checkmark,
      matched in height to the status control beside it. It must not be clickable.
13. Set that same item back to **To do**.
    - **Expected:** the button returns to **Run** / **Re-run** and is clickable again — this is
      the intended route to re-running finished work.
    - **Note:** changing an item's status by hand is a *permanent* override in this app (the
      spec-file sync will no longer move it), so do steps 12–13 on a throwaway item.

## Responsive

1. Device toolbar at **375px** (and again at **320px**), dashboard with no token.
   - **Expected:** the "Get started" rows stack — **"Open Settings" drops onto its own line
     below the explainer** rather than squeezing the text into a narrow column. The explainer
     should read as normal wrapped sentences, never one word per line.
   - **Expected:** no horizontal page scroll; the card never overflows the viewport.
2. **≥1280px.**
   - **Expected:** each row is a single line: icon · title+explainer · button pinned right.
3. Project detail at 375px — the rename field and the git buttons.
   - **Expected:** the rename input and its Save/Cancel wrap without overflow; Pull/Push wrap
     to their own line rather than pushing the tracking text off-screen.

## Dark mode

1. Toggle the theme control in the sidebar footer through **light → dark → system**.
   - **Expected:** the "Get started" card, the amber token row, the green done row and the
     neutral to-do row all invert cleanly. The amber row must stay legible amber-on-dark, not
     a washed-out block.
   - **Expected:** every text you can read is legible in **both** themes. Pay attention to the
     newly-brightened greys: the project path under a task title (`/tasks/<id>`), the file
     sizes on attachment chips, "no runs yet" on project rows, the agent version next to
     `/swe`, the sidebar's "NAVIGATE" eyebrow and `v0.4.1` footer, and the grey header lines
     inside a diff (`/projects/<id>` → click a changed file). These were all below AA before
     and should now read comfortably.

## Accessibility

1. **Keyboard only** on the dashboard: Tab from the page top.
   - **Expected:** focus reaches "Open Settings" in the checklist in reading order, with a
     visible focus ring; Enter navigates to Settings.
2. Turn on VoiceOver (⌘F5) and read the checklist.
   - **Expected:** each step is announced with its **state spoken first** — "Done: Add a
     project", "Next: Add your Anthropic token", "To do: Run your first task". The state must
     never be conveyed by the checkmark/colour alone.
   - **Expected:** the card is announced as a region named "Get started", and the steps as a
     **numbered list** of 3.
3. Contrast spot-check (browser devtools → inspect → contrast) on the greys listed in the dark
   mode step, in **light** theme.
   - **Expected:** ≥ 4.5:1 for all of them. `#67676f` on white is ~5.8:1; the old `#8e8e98`
     was ~3.25:1 and failed.
4. Tab into the folder picker modal.
   - **Expected:** focus is trapped in the dialog, Escape closes it, and focus returns to the
     Browse… button.

## Edge / failure cases

1. Remove `SECRETS_MASTER_KEY` from `.env` and restart, then open the dashboard.
   - **Expected:** the token step's explainer changes to the "server is missing
     SECRETS_MASTER_KEY … see .env.example" message and the **"Open Settings" button is not
     rendered** — there is nowhere useful to send you.
2. Have a token and tasks but **delete every project**.
   - **Expected:** the checklist reappears with "Add a project" as the outstanding step, and
     the dashboard's Projects card shows the dashed empty state with an "Add a project" button
     (it used to be a bare sentence).
3. Rename a project to a very long name, then click the pencil again.
   - **Expected:** the heading wraps rather than overflowing, and the edit field does the same.

## What success looks like

A brand-new user landing on the dashboard is told, in order and in one place, what an agent,
a project and a task are and exactly what to do first — and that card vanishes for good once
they've done all three. Everything that was previously too faint to read now meets AA in both
themes, and every text field and button in the app comes from the shared `Input`/`Button`
primitives, so focus rings and hover states are identical everywhere.
