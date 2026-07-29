# Test scenario: Sidebar navigation + light/dark theming

_Task: replaced the top navbar with a collapsible sidebar, added light/dark/system theming on a
semantic token layer, and consolidated buttons/modals into shared primitives · 2026-07-29_

## Setup / preconditions
- Docker running; the app's dev container up.
- Start the app: `pnpm dev` → open <http://localhost:3001>
- You need at least one registered project and one past task to exercise every screen.
- **Before you start:** open DevTools → Application → Local Storage → `http://localhost:3001`
  and delete the keys `cc-theme` and `cc-sidebar` if present, so you see true first-run
  behaviour.

## Happy path — theming

1. Set your OS to **Light** appearance, then hard-reload the page.
   - **Expected:** the app renders in **light** mode (white cards on a light grey page).
     No dark flash at any point during load.
2. Set your OS to **Dark**, return to the tab.
   - **Expected:** the app flips to dark **immediately**, without a reload — the default mode
     is `system`, and it listens for OS changes live.
3. In the sidebar footer, click the **sun** icon (left segment of the theme control).
   - **Expected:** light mode, regardless of the OS setting. The sun segment is visibly active.
4. Hard-reload the page.
   - **Expected:** still light, and **no flash of dark** before paint. This is the pre-paint
     init script doing its job — if you see a flicker, that's a bug.
5. Click the **monitor** icon (System).
   - **Expected:** snaps back to following the OS (dark, per step 2).
6. Open a second tab on the same URL. In tab A pick **dark**; switch to tab B.
   - **Expected:** tab B is already dark — the preference syncs across tabs.

## Happy path — sidebar

7. At a desktop width (≥ 768px), look at the left sidebar.
   - **Expected:** brand at top, a "Navigate" group with Dashboard / Agents / Projects, and a
     footer with the theme control + "Collapse". The current page's item is highlighted with
     an accent bar and accent icon.
8. Click **Collapse**.
   - **Expected:** the sidebar shrinks to a ~64px icon rail; labels disappear; the theme
     control becomes a single cycling icon button. Page content reflows wider — it should not
     be overlapped or clipped.
9. Hard-reload.
   - **Expected:** the sidebar is **still collapsed, on first paint** — it must not render
     expanded and then snap shut.
10. Expand it again, then navigate Dashboard → Agents → Projects.
    - **Expected:** the active highlight follows the current page every time.
11. Press <kbd>Tab</kbd> repeatedly from the top of the page.
    - **Expected:** every focusable element shows a **visible focus ring** — sidebar links,
      the theme segments, Collapse, and on into the page's buttons, inputs, and list rows.

## Happy path — mobile

12. Narrow the window below 768px (or use device emulation at ~375px).
    - **Expected:** the sidebar disappears. A slim top bar appears (brand + a theme icon
      button), and a **bottom tab bar** appears with Dashboard / Agents / Projects.
13. Tap through the bottom tabs; scroll a long page (e.g. a task with a big transcript).
    - **Expected:** the active tab is accent-coloured; the bottom bar stays fixed and never
      covers the last row of page content.

## Happy path — the rest of the UI in both themes

14. With **light** mode on, visit each screen: Dashboard, Agents, an agent detail page,
    Projects, a project detail page, and a task page.
    - **Expected:** all text is comfortably readable — no light-grey-on-white or
      white-on-white anywhere. Status badges (Done / Failed / Running / Queued) are legible
      and keep their colour meaning (green / red / amber / blue).
15. On a project with uncommitted changes, click a changed file to open the **diff modal**.
    - **Expected:** the modal opens, focus moves into it, added lines are green and removed
      lines red in both themes. Press <kbd>Esc</kbd> — it closes and **focus returns to the
      file row you clicked**.
16. Tab inside the open modal.
    - **Expected:** focus cycles within the modal and never escapes to the page behind it.
      The page behind does not scroll while the modal is open.
17. On a **workspace** project, use the repo tabs in Source Control: click one, then press
    <kbd>←</kbd> / <kbd>→</kbd> / <kbd>Home</kbd> / <kbd>End</kbd>.
    - **Expected:** arrow keys move between repo tabs (wrapping at both ends) and the panel
      below follows.

## Edge / failure cases

1. **Removing a project no longer uses a browser popup.** On a project detail page, click
   **Remove**.
   - **Expected:** no native OS confirm dialog. Instead the button becomes **"Confirm remove"**
     with a **Cancel** beside it and the note "Your files are untouched." Click **Cancel** —
     it returns to the plain Remove button with nothing deleted.
2. **A failed delete must not hang.** Stop the dev container's web process (or go offline),
   then click Remove → Confirm remove.
   - **Expected:** the spinner stops and a red error message appears. The buttons become
     usable again. *(Previously the spinner span forever with no message.)*
3. **Long transcript + open modal.** Start a task and, while it is actively streaming, open a
   test-scenario file link from a report to show the file modal. Leave it open for ~15s while
   output continues to stream.
   - **Expected:** focus stays where you put it inside the modal — it must **not** get yanked
     back to the modal panel on every streamed token. Closing it returns focus to the link.
4. **Storage disabled.** In DevTools, block storage for the origin (or use a hardened private
   window), then toggle the theme.
   - **Expected:** the theme still changes for the session; it simply doesn't persist across
     reloads. No error, no blank page.
5. **Tampered preference.** In DevTools console run
   `localStorage.setItem('cc-theme', '"><script>alert(1)</script>')` and reload.
   - **Expected:** the app falls back to `system` and renders normally. No alert, no broken
     markup — the value is validated against a `light|dark|system` allowlist before use.

## What success looks like

Navigation lives in a persistent, collapsible left sidebar on desktop and a bottom tab bar on
mobile, and the whole app renders correctly in light, dark, and system modes — with the right
theme on the very first paint, no flashes, readable contrast everywhere, and a visible focus
ring on every interactive element.

## Not covered by automated tests

This repo has no test framework, and tests were consciously deferred for this change. Nothing
above is verified automatically — please walk it manually. The highest-risk areas (and the
first things worth unit-testing if a framework is added) are the modal focus trap's behaviour
across parent re-renders, focus restoration on close, and the theme/sidebar stores'
`getSnapshot` stability and cross-tab sync.
