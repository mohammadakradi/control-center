# mac app and pwa

The native `Agent Control Center.app` bundle, the Swift/launcher split, the rename off Apple's "Control Center", and the installable PWA.

<!-- Moved out of CLAUDE.md on 2026-08-24 to bring it inside its 20 KB budget (engineering rule 7). Content is verbatim; only the heading level and this header are new. -->

## The Mac app (native window) and the PWA
**Naming:** the product is **Agent Control Center**. It was renamed from "Control Center" because
macOS ships a system service by that name — which made `tell application "Control Center"` target
Apple's (answering `User canceled (-128)` while ours kept running) and put two hits in Spotlight.
Renamed: the bundle (`Agent Control Center.app`), its id (`dev.agentcontrolcenter.app`), its
executable (`AgentControlCenter`), and every user-visible string. **Not** renamed, deliberately:
the `control-center` CLI (published release notes tell people to run it, and a terminal command
has no collision to worry about) and `~/.control-center` (renaming it would orphan existing data).
`make-app-bundle.sh` deletes a pre-rename bundle it recognises by the old id, so an update doesn't
leave two apps behind; `uninstall` quits and removes both names and both ids.

`Agent Control Center.app` in `/Applications` is the front door: double-click it, no terminal. The
bundle is built by `infra/release/make-app-bundle.sh` — on first install, after **every** update,
and on demand via `control-center install-app`. It comes in two forms:
- **native** (whenever `swiftc` exists — Xcode Command Line Tools): `infra/native/ControlCenter.swift`
  compiled locally into the bundle. A real `NSApplication` + `WKWebView`, so **it owns the window
  and therefore the Dock icon** — the whole reason it exists, since a Chrome `--app=` window puts
  *Chrome* in the Dock. It starts the server itself (`control-center start`, which also applies
  updates and migrations), polls until the server answers, and opens external links in the real
  browser. Compiling locally means nothing is downloaded, so nothing is quarantined: no signing,
  no notarisation, no Gatekeeper prompt.
- **launcher** (fallback, no Swift): a shell script that starts the server and opens a browser
  window. Same Applications entry and icon; the *window* is Chrome's.

Gotchas worth keeping:
- **The bundle probes two ports (7373, then 3001) rather than insisting on one.** `update`
  rebuilds the bundle from the new source but only refreshes the `control-center` command on
  versions that know to, so for exactly one update the window and the server can disagree about
  the port — and a bundle that insisted would sit on "Starting…" while a healthy server answered
  next door. `CC_URL` pins it when you know better.
- **A `WKWebView` has no file chooser of its own.** `<input type="file">` does *nothing* — no
  dialog, no error, nowhere — unless the host app implements
  `WKUIDelegate.webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`. It shipped
  without one, so "Attach files" was dead in the Mac app while working in a browser, and dropping
  a file on the composer was the only way to attach anything. Anything else WebKit delegates to
  the host (printing, JS `alert`/`confirm`, camera/mic permission) fails the same silent way, so
  add the delegate method rather than assuming browser behaviour. Its `completionHandler` must be
  called on every path or the input stays locked for the rest of the session.
- `infra/native/` **must stay in `pack.sh`'s allowlist** — without the Swift source an installed
  app can't rebuild its own bundle on update, and silently degrades to the launcher.
- The bundle is swapped with `mv`, never `rm -rf` in place: updates rebuild it while the app that
  triggered the update is running, and rename leaves the running inode alone.
- `CFBundleExecutable` is `ControlCenterApp`, not `ControlCenter` — macOS runs its own process by
  that name.
- `NSAppTransportSecurity` allows local networking; ATS blocks plain HTTP to localhost otherwise.
- The executable is unsigned. Fine while it's compiled on the machine that runs it; the day a
  prebuilt binary ships, it needs signing + notarisation or Gatekeeper will block it.

Separately, the *running* dashboard can also be installed from Chrome as a PWA — own window and
Dock icon, same server. `control-center start` prefers that bundle if it exists. Note the install
button lives in a **normal tab's** address bar; a `--app=` window has no menu for it.
- **Install:** open http://localhost:7373 in Chrome → install button in the address bar (or
  ⋮ → Cast, save, and share → Install page as app). That creates a real Mac app bundle under
  `~/Applications/Chrome Apps/` carrying the app's own icon — which is what puts Control Center
  in the Dock under its own logo. A bare `--app=` window is a Chrome window wearing Chrome's
  icon, so `control-center start` looks for that bundle and launches it in preference, nudging
  you once if it isn't there. `pnpm app` is the no-install path: it opens a Chrome window with
  `--app=` (`infra/launch/open-app.mjs`, falls back Chromium → Edge → Brave → default browser,
  and cross-platform).
- **Manifest:** `app/manifest.ts` → `/manifest.webmanifest`. Chromium's install criteria are
  `name`/`short_name`, a 192px **and** a 512px icon, `start_url`, `display`, and
  `prefer_related_applications` unset — over HTTPS or localhost.
- **No service worker, deliberately.** Chromium hasn't required one for installability for
  years, and its fetch handler would sit in front of the SSE task stream and dev HMR for no
  offline benefit on a local-only app. Don't add one without a concrete reason.
- **`proxy.ts` lets `/manifest.webmanifest` through signed out** — Chrome fetches it to decide
  installability, and a redirect to `/signin` makes the app un-installable.
- **Icons** are generated from the single brand mark in `app/icon.svg` by `pnpm icons`
  (`infra/icons/generate.mjs`): it composes the mark over the brand's dark radial background at
  three scales and rasterizes via macOS QuickLook (`qlmanage`) — there's no ImageMagick or
  librsvg here. Outputs are committed, so it only runs when the mark changes. Edit the mark,
  never the PNGs.
- **Trap — do not add `app/apple-icon.png`.** That Next file convention crashes metadata
  rendering on *every* page in this Next build (`ReferenceError: require is not defined`, a 500
  on `/signin` and everything else). The touch icon is declared by path instead, via
  `metadata.icons.apple` in `app/layout.tsx`. `app/icon.svg` (favicon) is fine.
- Per-scheme `<meta name="theme-color">` comes from the `viewport` export in `app/layout.tsx`.
  It follows the OS scheme, which can disagree with the in-app light/dark/system toggle — the
  standalone window chrome can't track that toggle.
