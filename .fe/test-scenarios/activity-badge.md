# Test scenario: running-tasks activity badge

_Task: a global "N in progress" pill in the app chrome, with a popover that jumps straight to any
in-flight task · 2026-08-12_

## Setup / preconditions
- Start the stack: `pnpm dev` (or `pnpm app`) → open <http://localhost:3001>
- You need **at least two tasks running at once**. Easiest: open a project, dispatch a task
  (`/fe:task` or `/swe:task` with any small request), then — without waiting — open a second
  project in another tab and dispatch one there too. Long-running requests make this easier to
  watch.
- The badge is scoped to *your* runs. If you sign in, you'll only see tasks dispatched by that
  account; signed out you're the local workspace. That's the point of the scoping, not a bug.

## Happy path
1. With **nothing** running, look at the top of any page (`/`, `/projects`, `/usage`).
   - **Expected:** No badge anywhere, and no empty strip or gap above the page heading. The
     layout is exactly as it was before this change.
2. Dispatch a task, then navigate to `/usage` (or any page other than the task's own).
   - **Expected:** Within ~5 seconds an amber-outlined pill appears at the **top right** of the
     content area, above the page heading, reading `⌁ 1 in progress`. On `/usage` it sits *above*
     the "7 days / 30 days / All time" switcher and must not overlap or cover it.
3. Dispatch a second task.
   - **Expected:** The pill updates itself to `2 in progress` without a page reload.
4. **Hover** the pill with the mouse.
   - **Expected:** A popover opens below it, headed "In progress" with a "View all →" link.
     Each row shows the task's name, a status badge (e.g. *Building & testing*, *Queued*,
     *Awaiting proposal approval*), and the project it's running in.
5. Move the mouse from the pill down into the popover and back out to the page.
   - **Expected:** The popover stays open the whole way down (no flicker as you cross the gap),
     and closes when the pointer leaves it.
6. **Click** the pill instead, then move the mouse away.
   - **Expected:** It stays open — a clicked popover is pinned. Clicking the pill again closes
     it; so does clicking anywhere else on the page.
7. Click one of the rows.
   - **Expected:** You land on that task's live page (`/tasks/<id>`) and the popover is closed.
8. Scroll down a long page (a task transcript is a good one) while something is running.
   - **Expected:** The pill stays stuck to the top of the viewport as you scroll. Page content
     passes behind it; the pill stays fully opaque and readable.
9. Let the tasks finish.
   - **Expected:** Within ~5 seconds of the last one finishing, the pill disappears and the
     content shifts back up.

## Responsive
1. Resize to ~375px (or use the device toolbar) with a task running.
   - **Expected:** The desktop strip is gone. The pill is in the **mobile top bar**, at the far
     right after the theme and sign-in icons, showing just the icon and the number (the words
     "in progress" are visually hidden below 640px — but still announced, see below). Tap it: the popover opens below the bar, fits fully
     on screen with a margin either side, and **nothing scrolls sideways**.
2. Narrow to 320px and tap the pill again.
   - **Expected:** Still no horizontal overflow; the popover's left edge stays on screen.
3. Resize to ≥1280px.
   - **Expected:** The pill sits at the top right, aligned with the right edge of the page
     content (same line as where a page's action buttons would be, but on its own row above
     them).
4. At ~768–900px (just past the `md` breakpoint) open `/backlog` with something running.
   - **Expected:** The pill's row is above the heading; the "Add item" button and project
     switcher are fully clickable and unobstructed.

## Dark mode
1. Toggle the theme (sidebar footer on desktop, sun/moon icon in the mobile bar) through
   **light → dark → system**, with the popover open.
   - **Expected:** In dark mode the pill has a solid dark surface with an amber border and
     amber text — page content must **not** show through it. The popover uses the standard dark
     popover surface (same as the agent/model dropdowns on a project page). Nothing renders as
     a washed-out or barely-visible amber block.

## Accessibility
1. With something running, press **Tab** repeatedly from the top of the page.
   - **Expected:** The pill receives a visible focus ring. Press **Enter** or **Space** — the
     popover opens. Keep pressing Tab: focus moves through the "View all" link and then each
     task row in order.
2. With the popover open and focus inside it, press **Escape**.
   - **Expected:** It closes and focus returns to the pill (not to the top of the page).
3. With the popover open, **Tab** past the last row.
   - **Expected:** The popover closes as focus leaves it — no orphaned panel left open behind
     you.
4. If you have VoiceOver (⌘F5) or another screen reader, focus the pill.
   - **Expected:** It is announced as a button named "2 in progress", collapsed or expanded —
     the words are hidden visually on a narrow screen but never removed from the name.
     Each row announces the task name, its status **in words**, and "Project <name>" — the
     status is never conveyed by colour alone.
5. Enable **Reduce Motion** (System Settings → Accessibility → Display) and open the popover.
   - **Expected:** The spinner on an active status badge stops animating; nothing else breaks.

## Edge / failure cases
1. Dispatch a task with a very long, multi-line request and no generated title yet.
   - **Expected:** The row shows the request collapsed onto **one** line, clipped with an
     ellipsis — never wrapped over several lines and never showing raw newlines. A task with no
     name at all reads "no description".
2. Open a project whose folder name is very long (or register one) and run a task there.
   - **Expected:** The project name truncates inside the row; the popover keeps its width.
3. Open the popover and wait for the **last** running task to finish while it's still open.
   - **Expected:** The popover does not vanish under your cursor — it stays, showing "Nothing
     in progress now", until you close it. (This protects keyboard users from losing focus.)
4. Open the popover by **clicking** it (so it's pinned), navigate away via the sidebar, then
   press the browser **Back** button.
   - **Expected:** The popover is closed on both pages. It must **not** pop itself back open
     when you return to the page you opened it on — that was a real bug caught in review.
5. Open DevTools → Network and filter to `active`. Switch to another browser tab for a minute
   with a task running, then come back and watch for ~30 seconds.
   - **Expected:** Requests to `/api/tasks/active` **stop** while the tab is hidden, one fires
     immediately on return, and then they settle back to **one every ~5 seconds** — not two.
     (A hide/show during an in-flight request used to fork the polling loop and double the rate
     for the rest of the session; this is the check that would catch it coming back.)
6. Sign in as a second account (or use a second browser profile) and dispatch a task there,
   then look at the first account's badge.
   - **Expected:** The other account's run is **not** counted and **not** listed.
7. Stop the server while the page is open with something running.
   - **Expected:** The pill keeps showing its last known count rather than blinking out of
     existence; no error toast, no console explosion.

## What success looks like
Whatever page you're on, you can tell at a glance whether agents are working for you and get to
any of them in two clicks — and when nothing is running the app looks exactly as it did before.
The pill and popover read as part of the existing chrome in both themes, work by mouse, touch
and keyboard alike, and never sit on top of a button you were trying to press.
