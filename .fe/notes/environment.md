# environment

Build/run environment traps — the container, the Next build, icons, lint, the live DB.

<!-- Split out of a single 79 KB `.fe/notes.md` on 2026-08-24, which was read in full at the start of every request (frontend rule 10). Entries are verbatim; only this header is new. -->

## Next.js version warning
This project uses Next.js `16.2.9` — far beyond the public release train. Per `AGENTS.md`, read `node_modules/next/dist/docs/` before writing any Next.js code. Route params are typed as `Promise<{id: string}>` (async params), and pages use `export const dynamic = "force-dynamic"`.

## There IS a test suite now (superseded "no test suite", 2026-08-01)
`pnpm test` runs Node's built-in runner via `tsx` over `runner/*.test.ts` **and** `lib/*.test.ts` — no extra deps. Pure UI logic belongs there (`lib/usage-format.test.ts` is the frontend-side example). There's still no DOM/component test tooling, so rendering and interaction are verified by hand; don't invent a React testing setup without agreeing it with the user first.

## `drizzle.config.ts` hardcodes the LIVE db — always pass `--url` explicitly
`npx drizzle-kit push` with `PLATFORM_DB=…` in the env **ignores it** and targets
`./data/platform.db`, because the config file hardcodes that path and nothing reads the env
var. To build a throwaway DB, pass the flags the tests use:
`npx drizzle-kit push --dialect=sqlite --schema=./lib/db/schema.ts --url=/tmp/x.db --force`.
(`PLATFORM_DB` *is* honored by `lib/db/index.ts` at runtime — it's only the drizzle-kit CLI
that doesn't see it.)

## Interleaving `{expr}` with prose drops the spaces between them
`{n} task{n === 1 ? "" : "s"} predates …` rendered as **"90 taskspredates"** — JSX dropped the leading space of the text node after the expression. Build sentences that mix counts and words as a **single template string** (`{`${n} tasks predates …`}`), or the missing space only shows up in the browser. Found by curling the real page, not by reading the JSX.

## `pnpm build` fails natively in OrbStack Linux
Running `pnpm build` outside Docker fails with `invalid ELF header` on `better-sqlite3.node` because that native binary is compiled for macOS on the host. The full dev/build cycle must run inside Docker (`pnpm dev`). Lint (`pnpm lint`) works natively.

## React lint: no `setState` inside `useEffect` bodies
This Next 16 / React build errors on `react-hooks/set-state-in-effect` — calling a state setter synchronously in an effect body is a hard error (not a warning). Do resets in event handlers (e.g. an `openMenu()` helper) and **derive** values at render time (clamp an index with `Math.min` instead of correcting it in an effect). Effects may only do DOM/external sync (focus, scrollIntoView), never `setState`.

## The task detail page currently 500s — the live DB is corrupt (2026-08-01)
`/tasks/<id>` returns 500 for **every** task on this instance: reading `task_events` throws `SQLITE_CORRUPT: database disk image is malformed` (even `PRAGMA integrity_check` throws). Verified against a clean tree, so it predates the usage work. `data/platform.db.corrupt.old` shows this has happened before. Every other route is fine — the rest of the schema reads normally. Recovery (`.recover` into a fresh file, or restoring `data/backup/`) is the operator's call, not something to run blind.

## No native OS dialogs — the app runs in a Linux container (2026-08-04)
The Add-project **Browse…** button used to POST `/api/fs/pick`, which ran macOS
`osascript -e 'choose folder'`. In the normal dev path (`pnpm dev` → Docker) `process.platform`
is `linux`, so it always returned 400 *"The native folder picker is only available on macOS"* —
the visible bug. There is no fix that keeps a native dialog: the container has no macOS GUI and
can't reach the host's. `osascript`, `open`, and anything else GUI-bound are off the table for
this app; build the affordance in-app instead.

Replacement: `components/FolderPicker.tsx` (modal folder browser) + `app/api/fs/list` +
`lib/fs-browse.ts`. Browsing is **jailed** to `PROJECT_ROOTS` (compose sets it to the host's
paths — now `$HOME:/Users:/Volumes`, first entry = where it opens, the rest are switchable
roots; the container's own `homedir()` is `/home/node`, so a default would land there instead).
**The mount, not the jail, is the real limit** — widening the roots to a path that isn't
bind-mounted just shows an *empty folder*, and a project there can't run because the runner
can't see it either. That's also why `/` isn't a root: inside the container it's the container's
filesystem, not the Mac's, so it would advertise host paths that don't exist.

Two consequences worth remembering: (1) `parent` is offered whenever the parent is itself inside
*some* root, so multiple roots let you walk up (`~/you` → `/Users`) while a single root stays a
ceiling; (2) with no env var the roots are home **plus** the parents of registered projects —
not one as a fallback for the other, because `/home/node` always exists in the container and a
fallback would therefore never fire.
Jail checks compare `realpathSync` on both sides — a raw string prefix check breaks on macOS
where `/tmp` and `/var/folders/…` are symlinks. Typed paths bypass the picker entirely and are
still unrestricted, which is the escape hatch for symlinked or dot-dir folders (both skipped by
the listing on purpose).

## A new route directory needs a dev-server restart (2026-08-04)
Adding `app/api/fs/list/route.ts` 404'd in the browser for as long as the dev server kept
running, while `.next/server/app-paths-manifest.json` still listed only the route I had just
deleted. File watching over the macOS bind mount misses newly *created directories*, and
`touch`ing files inside the container does not wake it. Restart (`pnpm stop && pnpm dev`).
Debugging note: `curl`ing an `/api/*` route unauthenticated proves nothing — `proxy.ts:31`
answers 401 before Next routes the request, so the route can 404 and you'd never know.

## `app/apple-icon.png` is poison in this Next build (2026-08-04)
Adding the static `app/apple-icon.png` metadata-image convention made **every** page 500 with
`ReferenceError: require is not defined` — `/signin` included, because the failure is in the
root layout's metadata resolution, not in the icon route. Removing the file fixed it instantly.
`app/icon.svg` (favicon) and `app/manifest.ts` are both fine; it's specifically the raster
`apple-icon` convention. Declare the touch icon by path instead:
`metadata.icons = { apple: "/icons/apple-touch-icon-180.png" }`, with the PNG in `public/`.
Another entry for the AGENTS.md "this is not the Next.js you know" list.

## App icons come from one SVG — never hand-edit the PNGs
`pnpm icons` (`infra/icons/generate.mjs`) composes `app/icon.svg` over the brand's dark radial
background and rasterizes 192/512/maskable-512/apple-180 through macOS QuickLook (`qlmanage`) —
there is no ImageMagick or librsvg on the host or in the container, and `sips` can't read SVG.
Change the mark in `app/icon.svg`, re-run, commit the PNGs.
