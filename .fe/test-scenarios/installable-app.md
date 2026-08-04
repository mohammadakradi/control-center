# Test scenario — Installable app (PWA) + `pnpm app`

**Change:** the dashboard can be installed from Chrome as a standalone app, and `pnpm app`
starts the stack and opens it in an app window.
- `app/manifest.ts` → `/manifest.webmanifest` (name, 192 + 512 icons, `start_url`, `standalone`).
- `public/icons/*` generated from `app/icon.svg` by `pnpm icons` (`infra/icons/generate.mjs`).
- `app/layout.tsx` — `applicationName`, `appleWebApp`, `icons.apple` (by path, **not** the
  `app/apple-icon.png` convention), and per-scheme `theme-color` via the `viewport` export.
- `proxy.ts` — `/manifest.webmanifest` reachable while signed out.
- `package.json` — `pnpm app` (detached compose + Chrome `--app=`), `pnpm icons`.

No service worker: Chromium doesn't require one, and it would intercept the SSE task stream.

## 1. `pnpm app`
1. From a clean state (`pnpm stop`), run `pnpm app`. It builds/starts the container detached,
   prints "Waiting for http://localhost:3001 …", then opens a **Chrome window with no tabs and
   no address bar**, and prints the stop hint.
2. Run it again while already up → no rebuild churn, window opens immediately.
3. `pnpm stop` → container down. Running `pnpm app` with Docker stopped fails with the
   `docker logs platform` hint rather than hanging forever (3 min cap).

## 2. Install as an app
1. Open http://localhost:3001 in a normal Chrome tab, signed **out**. The address bar shows the
   install affordance — this is the signed-out check that matters, since Chrome fetches the
   manifest before you have a session.
2. Install it. Expect: a standalone window, the ring/C mark in the Dock and Launchpad
   (macOS) with a **rounded tile** and no white box, and the app in `⌘Tab`.
3. Right-click the Dock/taskbar icon → shortcuts to **Projects**, **Agents**, **Usage** jump
   straight to those routes in the app window.
4. Sign in inside the installed window; navigate around. Links stay in the app window
   (`scope: "/"`); an external link (e.g. the Anthropic console link in Settings) opens a
   browser tab instead.
5. Open a running task in the installed window → the live SSE transcript still streams. (This
   is the check that matters if anyone ever adds a service worker.)

## 3. Manifest + assets
1. `curl -s localhost:3001/manifest.webmanifest` → **200**, `application/manifest+json`, valid
   JSON, no session cookie needed.
2. `curl -o /dev/null -w '%{http_code}' localhost:3001/icons/icon-512.png` → **200** (and
   `icon-192`, `icon-maskable-512`, `apple-touch-icon-180`).
3. `curl -s localhost:3001/signin | grep -E 'manifest|apple-touch-icon|theme-color'` → the
   manifest link, the apple-touch-icon link, and **two** theme-color metas (light + dark).
4. DevTools → Application → Manifest: no errors, both icons listed, "Installability: installable".
5. **Regression guard:** `/signin` returns **200**, not 500. If it 500s with
   `ReferenceError: require is not defined`, someone re-added `app/apple-icon.png`.

## 4. Icon pipeline
1. `pnpm icons` re-emits the four PNGs at 192/512/512/180 (`sips -g pixelWidth` to confirm) and
   leaves `git status` clean if `app/icon.svg` hasn't changed.
2. Tweak `app/icon.svg`, re-run, and the change shows in every output — the mark is not
   duplicated anywhere.
3. Maskable check: at [maskable.app](https://maskable.app/editor) (or by eye) the mark sits well
   inside the circular crop with no clipping.
