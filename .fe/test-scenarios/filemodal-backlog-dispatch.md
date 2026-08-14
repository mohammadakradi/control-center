# Test scenario: "Create task" in the file modal runs through the backlog

_Task: dispatching a pm task spec from the file modal moves that spec's **backlog item** through
the same lifecycle as pressing Run on the backlog page — linked to the task, in progress while it
runs, done when it finishes · 2026-08-14_

## Setup / preconditions
- The dev stack running: `pnpm dev` → <http://localhost:3001>
- A registered project the pm agent has planned into, i.e. it has
  `.pm/tasks/<timestamp>/NN-something.md` files. **This repo itself works** — register
  `/Users/moh/Dev/agent/platform`.
- An Anthropic token saved under **Settings** (one step below deliberately checks the state
  without one).
- One finished task whose report or proposal mentions a spec path in backticks — that is what
  makes the path clickable and opens the modal. Any `/pm:plan` run produces several.

## Happy path
1. Open a finished task at `/tasks/<id>` and find an inline `` `.pm/tasks/…/NN-….md` `` path in
   the transcript. Click it.
   - **Expected:** the file modal opens showing the spec, with **Copy** and
     **Create task → fe** (or **→ swe**) in its header. Unchanged from before.
2. In a second tab, open **Backlog** and find the item for that same spec (match the mono
   `sourcePath` under the title). Note its status — it should be **To do** with no *Last run*.
3. Back in the modal, press **Create task → …**.
   - **Expected:** the button shows *Creating…*, then the browser navigates to `/tasks/<new id>`
     and the task streams live.
   - **Expected:** the task is titled with the **spec's own title** (the frontmatter `title:`),
     not a model-written summary of it.
4. Reload the **Backlog** tab.
   - **Expected — this is the whole point of the change:** that item now reads **In progress**,
     shows **Last run** with the task's status badge and an **Open task** link, and its button
     reads **Running** (disabled). Before this change it stayed at *To do* with no link forever.
5. Let the task finish, then reload `/backlog`.
   - **Expected:** the item has moved to **Done & cancelled** and its button reads **Re-run**.

## The 409 — the same work dispatched twice
1. While the task from step 3 is still running, reopen the same spec path in the file modal and
   press **Create task** again.
   - **Expected:** a red bar across the top of the modal reading *"This item is already running
     as task task_… (running)."* followed by an underlined **Open the task** link. The modal stays
     open, the spinner stops, and **no second task is created**.
2. Click **Open the task**.
   - **Expected:** it navigates to the run that was already going — the same task from step 3.
3. Press **Create task** a second time on that same error.
   - **Expected:** the previous message and link are cleared while the request is in flight, so
     you never see a stale error next to a live spinner.

## The fallback — a spec with no backlog item
The direct dispatch is still there for specs the backlog can't hold. Both of these must still
create a task, they just won't link to anything.
1. Register a **workspace** project and open a spec that lives in a *member* repo
   (`<member>/.pm/tasks/…`), then press **Create task**.
   - **Expected:** a task is created and you land on `/tasks/<id>`, exactly as before. Only the
     project root's `.pm/tasks/` is scanned into the backlog, so there is no item to link — and
     it must **not** attach itself to a same-named spec in the root project.
2. Hard-link a spec so the scan refuses it
   (`ln .pm/tasks/<req>/01-x.md .pm/tasks/<req>/01-x-copy.md`), reload `/backlog` to confirm the
   amber "entries were skipped" bar, then open that spec in the modal and press **Create task**.
   - **Expected:** a task is still created. Remove the hard link afterwards.

## Responsive
1. At **≥1280px** and at **768px**.
   - **Expected:** the modal is centred and capped at `max-w-3xl`; the error bar spans its full
     width under the header.
2. At **390px** (device toolbar, iPhone 12).
   - **Expected:** the error message **wraps onto a second line inside the bar** and the
     **Open the task** link wraps with it — never clipped at the modal's right edge, never on its own
     orphaned line with the bar growing past the modal.
   - _Note: verify this one in a real browser. macOS Chrome clamps a headless window to a 500px
     minimum layout width, so 390px cannot be screenshotted from the CLI._

## Dark mode
1. Trigger the 409 error (above) and toggle the theme control through **Light → Dark → System**.
   - **Expected:** the bar stays `bg-danger-soft` with `text-danger` text in both themes — a pale
     pink wash with dark red text in light, a deep red wash with light red text in dark. The
     **Open the task** link is the *same colour* as the message, distinguished by its underline and
     slightly heavier weight, never a blue link on a red bar.

## Accessibility
1. With the modal open, press **Tab** repeatedly.
   - **Expected:** focus cycles within the dialog only — Copy, Create task, Close, and (when an
     error is showing) the **Open the task** link — each with a visible focus ring. **Esc** closes and
     returns focus to the transcript path that opened it.
2. With a screen reader (VoiceOver: ⌘F5), trigger the 409.
   - **Expected:** the message is announced **once, as one sentence including the link text**
     ("This item is already running as task … Open the task"), because the link lives inside the same
     `role="alert"` paragraph — not as two separate announcements.
3. Follow **Open the task** with the keyboard (Tab to it, Enter).
   - **Expected:** it navigates like any link; it is a real anchor, not a button styled as one.

## The lookup itself failing — the case that must *not* dispatch
This is the one behaviour that is easy to get wrong in the safe-looking direction: if the app
can't read the backlog, it can't know whether this spec is already running, and the fallback
path has no duplicate check.
1. With the modal open on a root spec, stop the app's ability to answer the backlog read —
   easiest is DevTools → Network → **Block request URL** on
   `*/api/projects/*/backlog` (block the exact GET, not the `/run` POST) — then press
   **Create task**.
   - **Expected:** *"Couldn't read this project's backlog, so nothing was started — running this
     now could start a second copy of work that's already going. Try again."* The spinner stops
     and **no task is created** — check `/tasks` to confirm the count didn't move.
   - **Expected:** the failure is also in the browser console with the spec's path, so a support
     question about it is answerable.
2. Unblock the request and press **Create task** again.
   - **Expected:** the refusal clears and the dispatch goes through normally.

## Edge / failure cases
1. With **no Anthropic token** saved, press **Create task**.
   - **Expected:** the error bar shows the server's message with an **Open Settings** link, the
     spinner stops, and no task is created. (Before this change the token hint was dropped and
     you got the bare message.)
2. Stop the runner (`docker stop platform`) and press **Create task**.
   - **Expected:** a message in the bar and the spinner stops — never a button stuck on
     *Creating…*.
3. Double-click **Create task** fast.
   - **Expected:** one task. The button disables itself on the first click and the handler
     refuses a re-entry, so a fast double-click can't buy two sessions.
4. Open a request's **`index.md`** in the modal, and an **`index.markdown`** if you make one.
   - **Expected:** no **Create task** button on either — an index is a description of a batch,
     not a piece of work. (`.markdown` is newly excluded; it used to offer the button for a file
     the backlog scan skips.)

## The same alert everywhere (`ErrorAlert`)
The error-with-a-link treatment is now one component, so these three must look and behave
identically apart from density:
1. `/backlog` → press **Run** twice quickly on one item.
2. A project page → dispatch with **no Anthropic token** saved (the `NewTaskForm` composer).
3. The file modal → the 409 from the section above.
   - **Expected in all three:** the message and its link read as one sentence, the link is
     underlined and the same colour as the message, and a screen reader announces it once. Only
     the size and spacing differ (the modal's is a full-width bar under the header; the other two
     are inline notes).

## What success looks like
The backlog stops lying. A spec dispatched from a transcript is the same event as a spec
dispatched from the backlog page: one item, one link, one lifecycle — and pressing the button
twice tells you where the first run went instead of quietly starting a second one.
