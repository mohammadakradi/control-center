# Test scenario — In-app folder picker (Add project → Browse…)

**Bug:** On `/projects`, **Browse…** returned _"The native folder picker is only available on
macOS. Type or paste the path instead."_ The route (`/api/fs/pick`) ran macOS `osascript`, but
the app runs in the Linux dev container, so it always 400'd.

**Change:**
- Removed `app/api/fs/pick/route.ts` (a native dialog can never work in the container).
- Added `lib/fs-browse.ts` — directory listing jailed to browse roots (`PROJECT_ROOTS`,
  colon-separated; else the home dir; else the parents of registered projects).
- Added `app/api/fs/list/route.ts` — `GET ?path=…`, signed-in only.
- Added `components/FolderPicker.tsx` — modal folder browser; `AddProjectForm` opens it.
- Compose now mounts **`/Users` and `/Volumes`** at their identical absolute paths and sets
  `PROJECT_ROOTS=${HOME}:/Users:/Volumes` — a project can live anywhere under those, not just
  `~/Dev`. The picker opens at the first root and the others show as footer chips.

Run with `pnpm dev` (Docker) and open http://localhost:3001/projects.
**Recreate the container first** (`pnpm stop && pnpm dev`) — a plain restart is not enough:
the mounts and `PROJECT_ROOTS` are compose changes, and a newly added route directory isn't
hot-reloaded over the bind mount either (it 404s until the dev server restarts).

## 1. Happy path
1. Click **Browse…** in the *Add project* card. A modal opens titled with the current folder
   in mono; the body lists the sub-folders of your home dir, alphabetically
   (case-insensitive) — `Dev`, `Documents`, `Library`, … .
2. Folders containing `.git` show a sky `FolderGit2` icon; plain folders a grey `Folder`.
   Folders already registered as projects show a muted **Added** tag.
3. Click a row → it navigates *into* that folder (header + footer path update, list refreshes).
4. Click **Select this folder** → the modal closes and the path lands in the text input.
5. Click **Add project** → the project is created and appears in the list below.

## 2. Navigation: up, roots, and the ceiling
1. From your home dir, **Up** is *enabled* and goes to `/Users` (a wider root sits above it);
   **Home** is disabled because you're already at the starting root.
2. From `/Users`, **Up** is disabled — that's the outermost root, the ceiling.
3. Navigate two levels deep (e.g. `Dev/agent`) → **Up** walks back one level, **Home** jumps
   straight to your home dir.
4. In the footer, click the `/Volumes` chip → the listing switches to that root (empty unless a
   drive is mounted; drives plugged in *after* the container started may not appear).
5. Paste `/Users/<you>/Documents` into the **Go** field and press Enter (or click **Go**) → it
   jumps straight there, Finder's ⌘⇧G equivalent. A bogus path shows the error instead of
   silently bouncing you to the root.
6. Hidden folders (`.git`, `.fe`, `.next`, …) and `node_modules` never appear.
7. A folder with no sub-folders shows "No sub-folders here. Select this folder, or go back up."
   — and **Select this folder** still works there (leaf projects are the normal case).

## 3. Pre-filled and rejected paths
1. Type `/Users/<you>/Documents` into the field, then click **Browse…** → the picker opens
   *at that folder*, not at the root.
2. Type `/etc` (above the root), then **Browse…** → the picker silently falls back to your
   home dir instead of dead-ending. (One retry only.)
3. Cancel out, type a valid absolute path outside the roots by hand, and click
   **Add project** → it still registers. Typed paths are deliberately *not* jailed; only
   browsing is. Such a project only *works* if its path is bind-mounted into the container.

## 4. Errors
1. `curl -i http://localhost:3001/api/fs/list` (no session cookie) → **401** `Unauthorized`.
2. `curl` with a session cookie and `?path=/etc` → **403**, message names the roots.
   `?path=<root>/no-such-dir` → **404**. `?path=<root>/some-file.txt` → **400**.
3. Delete/rename a folder while the picker is open, then click its row → a red banner appears
   above the list and the previous listing stays on screen (it does not blank out).

## 5. Keyboard & accessibility
1. **Tab** into the modal: every row is a real `<button>`, so rows are reachable and **Enter**
   navigates into one. The focus trap keeps Tab inside the dialog.
2. Press **Enter** in the **Go** field, empty and with a path → jumps or does nothing, and
   critically the *Add project* form does **not** submit (the picker renders outside that
   `<form>`, and the field also preventDefaults Enter).
3. **Esc** closes the picker and focus returns to the **Browse…** button.
4. Clicking the scrim closes it; clicking inside does not.
5. The **Go** field has an `sr-only` label; icon-only Home/Up buttons carry `aria-label`s
   ("Go to the starting folder", "Go to the parent folder"); decorative icons are
   `aria-hidden`; the error banner is `role="alert"`; the list carries `aria-busy` while a
   fetch is in flight.

## 6. Theme + responsive
1. Toggle **light / dark / system** with the picker open — surfaces use `bg-sunken` (body),
   `bg-surface` (panel), `hover:bg-surface-3` (rows); no light-mode artifacts, no `dark:`
   variants in the component.
2. At ~375px: the modal fits (`max-w-xl` + `p-4` scrim padding), long folder names truncate,
   the Go field + button and the footer path/buttons wrap rather than overflow (`flex-wrap`,
   `break-all`), with no horizontal page scroll.
