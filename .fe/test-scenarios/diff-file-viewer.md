# Test scenario: Diff & file viewer — syntax highlighting, split view, file navigation

_Task: the diff modal gained syntax highlighting, a unified↔split toggle and prev/next file
navigation; the file modal now renders code with highlighting and line numbers · 2026-08-20_

## Setup / preconditions
- **Run `pnpm dev:clean` before `pnpm dev` the first time.** This change adds two dependencies
  (`lowlight`, `highlight.js`) and `node_modules` lives in a named Docker volume, so a
  container built before this lands won't have them and the build will fail. Native
  (`pnpm dev:local`) just needs `pnpm install`.
- A registered project that is a **git repo with several uncommitted changes** — ideally a mix
  of file types (`.ts`/`.tsx`, `.css`, `.json`, `.sh`, `.md`) and a mix of statuses (modified,
  new/untracked). This repo's own checkout while you have work in progress is perfect.
- Start the app: `pnpm dev` → open <http://localhost:3001> (or a release install on
  <http://localhost:7373>).
- Go to **Projects → your project**, and find the **Source control** card's changed-file list.

## Happy path
1. Click a **modified `.ts`/`.tsx`** file in the changes list.
   - **Expected:** the diff modal opens. The code is **syntax-highlighted** — keywords violet,
     strings green, comments grey and *italic*, types/attributes teal, numbers amber. Added
     lines sit on a green wash with a `+`, removed lines on a red wash with a `−`, and every
     row has **two line-number columns** (before / after) in the left gutter.
2. Look at the top of the panel.
   - **Expected:** the `diff --git` / `---` / `+++` header lines in small faint mono, then each
     hunk introduced by its own `@@ -a,b +c,d @@` bar in accent blue on a `surface-2` band,
     with the enclosing function name beside it where git supplied one.
3. Click the **Split view** icon (two columns) in the modal header.
   - **Expected:** the panel widens and the diff becomes side-by-side — old on the left, new on
     the right, with a divider between them. A line with nothing opposite it shows a faint
     empty half rather than shifting the other side up. **Every pair stays aligned even when a
     long line wraps** onto two or three visual lines.
4. Click the **Unified view** icon (rows) to switch back.
   - **Expected:** returns to the single-column view; the panel narrows again. Both views show
     exactly the same lines — nothing appears or disappears between them.
5. With several files changed, click the **›** (next file) button in the modal header.
   - **Expected:** the header path changes to the next file, the counter goes `5 / 17` → `6 / 17`,
     and the new diff loads. The **previous file's diff is never left on screen** under the new
     file's name.
6. Press **`]`** and **`[`** on the keyboard.
   - **Expected:** same forward/backward movement as the buttons. At the last file, `]` wraps
     around to the first (and `[` from the first wraps to the last) — the counter makes this
     obvious.
7. Close the modal and click a **new (untracked)** file.
   - **Expected:** every line is an addition (green, `+`, only the right-hand line numbers
     populated), still syntax-highlighted, with no empty "before" column of numbers.
8. Open a task with a report that links a file (e.g. a `.fe/test-scenarios/*.md` path) — or any
   route that opens the **file** modal — and open a **non-markdown** file such as a `.sh` or
   `.json`.
   - **Expected:** the file renders with **line numbers and syntax highlighting** instead of the
     old flat grey monospace block. A `.md` file still renders as formatted markdown, unchanged.

## Responsive
1. Resize to **~390px** (device toolbar, iPhone-ish) and open a diff.
   - **Expected:** the modal header truncates the path but keeps ‹ › and the view toggle usable;
     the `5 / 17` counter is hidden below 640px. Code wraps rather than overflowing, and
     **the page itself does not scroll sideways**.
2. Still at ~390px, switch to **Split view**.
   - **Expected:** the two columns keep a readable minimum width and the *modal body* scrolls
     horizontally to reach the right-hand side. The page behind it still does not scroll
     sideways. Switching back to Unified removes the horizontal scroll.
3. Resize to **≥1280px**.
   - **Expected:** unified view is capped at a comfortable reading width; split view is wider.

## Dark mode
1. Toggle the theme in the sidebar footer (Light / Dark / System) with a diff open.
   - **Expected:** the highlighting re-themes with the rest of the app — no colour stays stuck
     at its light value, no washed-out or unreadable token. Added/removed washes stay legible
     behind the coloured code in both themes.
2. Check a comment-heavy file in **light** mode specifically.
   - **Expected:** comments are clearly readable, not a pale grey that disappears against the
     `sunken` background.

## Accessibility
1. Open a diff and navigate it **keyboard only**.
   - **Expected:** Tab reaches, in order: ‹ previous, › next, the view toggle, ✕ close, then the
     diff body itself. Tab from the body wraps back to ‹, Shift+Tab from ‹ wraps to the body.
     Every stop has a visible focus ring. **Esc** closes.
2. With the view toggle focused, press **← / →** (and Home / End).
   - **Expected:** the layout switches as focus moves between the two segments — the toggle is
     a single tab stop, not two.
3. Press **›** repeatedly with the keyboard until you pass the last file.
   - **Expected:** focus **stays on the Next button** the whole time; it is never dropped back
     to the top of the page.
4. Focus the diff body and press ↑/↓/PageDown.
   - **Expected:** the diff scrolls. (This is why the body is a tab stop.)
5. With a screen reader (VoiceOver: ⌘F5), navigate files with ‹ ›.
   - **Expected:** each move is announced as "File 6 of 17: <path>". Line numbers are **not**
     read out line by line, but the `+` / `−` markers **are** — added and removed are not
     signalled by colour alone.

## Edge / failure cases
1. `chmod +x` a tracked file (`chmod +x some-script.sh`), reload, and open its diff.
   - **Expected:** a plain sentence — "File mode changed from 100644 to 100755. The contents are
     unchanged." — not a blank panel.
2. Open the diff of a **binary** file (add a `.png`).
   - **Expected:** "Binary file — there is no text diff to show." No empty code area.
3. Open a file type with no grammar (e.g. `LICENSE`, or a `.someext` file).
   - **Expected:** it still renders with line numbers, just uncoloured. Nothing errors.
4. Open a **very large** file in the file modal (>200 KB, or >5 000 lines).
   - **Expected:** it renders as plain text with a visible note explaining that highlighting
     (and, past 5 000 lines, line numbering) is off — it never silently truncates the content.
5. Open a diff of a file with **CJK / emoji / very long unbroken tokens** (a minified line, a
   base64 blob).
   - **Expected:** the row wraps or the body scrolls; the layout doesn't break and the gutters
     stay aligned.
6. Open a **submodule** entry, if the project has one.
   - **Expected:** the `Subproject commit …` lines render as an ordinary removed/added pair.

## What success looks like
Reviewing a stack of uncommitted changes no longer means opening and closing the modal once per
file, and the code inside it reads like a code-review tool rather than a wall of monospace: the
colours come from the same token layer as the rest of the app and follow light/dark with it,
add/remove is legible without relying on colour, and both the unified and side-by-side layouts
show exactly the same lines.
