# pages and surfaces

Per-surface notes: what each page is for and the decisions behind it.

Part 2 of 3.

<!-- Split out of a single 79 KB `.fe/notes.md` on 2026-08-24, which was read in full at the start of every request (frontend rule 10). Entries are verbatim; only this header is new. -->

## Toasts — the attention layer, and why it reads truth instead of inferring it (2026-08-20)
`components/Toaster.tsx` + `lib/toast.ts` + `lib/task-toasts.ts`. Anywhere in the app, a run
reaching a gate or finishing raises a dismissible card linking to it. Six decisions worth not
relitigating:

- **`/api/tasks/active` had to grow a `finished` list; inferring completion from absence cannot
  work.** The obvious build is "diff the active list, and a task that vanished is over" — and it
  is wrong twice. It can't tell `done` from `failed` from `cancelled`, which are the three
  different things you'd want to be told; and `tasks` is capped at `ACTIVE_LIST_LIMIT` (12) while
  `total` isn't, so a *still-running* task drops out of the list just by being pushed down it.
  The route now `or`s in terminal rows with `endedAt` inside `FINISHED_WINDOW_MS` — one query, no
  second round trip on a route polled from every page — and nothing anywhere infers from a gap.
- **The 60s window is not a dismissal timer, and one rule keeps it from becoming one.** Only a
  *gate* notice is ever retracted. "Awaiting your approval" stops being true the moment the run
  moves on; "this run failed" never does — so if terminal notices were also cleared when their
  row aged out of the window, every completion toast would quietly vanish after a minute, which
  is exactly the timed auto-dismiss `lib/toast.ts` refuses to have. There's a spec pinning it
  (`a terminal notice is never withdrawn`), and reverting the gate-only filter turns it red.
- **Nothing auto-dismisses.** WCAG 2.2.1 wants content that disappears on a timer to be pausable
  or extendable; sticky-and-dismissible sidesteps that instead of owing it a hover-pause, a
  focus-pause and a re-announce. The product argument is the same one: a gate toast that expired
  after six seconds while you were in another window is the problem this was built to fix. What
  stops it becoming clutter is `key` (same subject → replace in place, not a second card),
  `TOAST_LIMIT` = 4, gate retraction, and dismiss-on-navigate.
- **The diff can't live in the component.** It needs the *previous* snapshot and
  `useSyncExternalStore` only hands you the current one — so keeping it in component state means
  `setState` in an effect (a hard error in this build) and doing it in render is a side effect in
  render. `lib/task-toasts.ts` holds it in module scope beside the store it mirrors, ref-counted
  so a remount can't install two watchers. `Toaster` only mounts it and reads.
- **The container is always mounted, which is *why* it needs `pointer-events-none`.** A live
  region has to exist before content is inserted for a screen reader to announce that content, so
  rendering `null` when empty announces nothing — but a permanently-mounted `fixed` corner element
  then swallows clicks on whatever is under it for the life of the page. `pointer-events-auto` goes
  on each card. One polite region for every tone, deliberately: no `role="alert"` on the failures,
  because an assertive alert nested in a polite region is two announcements for one event
  (`UpdateBanner`'s trap).
- **`bg-surface` + a tone-tinted border, never `bg-{tone}-soft`** — the third time this rule has
  been needed. The soft tones are translucent in dark mode and this floats over scrolling content.
  Same reason "Dismiss all" is `variant="secondary"` rather than `ghost`: a transparent button
  floating over an arbitrary paragraph is unreadable. Caught by looking at it, not by reasoning.
- **The stack scrolls, and `TOAST_LIMIT` is not a substitute for that.** Bottom-anchored means it
  grows upward, so on a short viewport (a phone in landscape) the *topmost* card leaves the
  screen — and topmost is oldest, i.e. the longest-pending gate. Lowering the cap doesn't fix it;
  three cards overflow a landscape phone too. The awkward part is that the scroll container needs
  `-m-2 p-2` (`overflow` clips at the padding edge and would shear the flat sides off every
  card's `shadow-2xl`) and that both the padding and `pointer-events-auto` must be conditional on
  there being toasts — padding on the always-mounted empty live region would give it height and
  reintroduce exactly the click-swallowing corner strip `pointer-events-none` exists to prevent.
  Found by design review; I had talked myself out of it on the grounds that "Dismiss all" stays
  reachable, which is true but loses the card you most wanted.

**Verifying it without a gate to trigger.** Real gates cost a model call and minutes. Instead,
temporarily append a scripted `emit(parseActiveTasks(…))` after the real one in `poll()`,
auto-advancing one step per poll — that exercises everything from `parseActiveTasks` down
(transitions, keying, retraction, layout) with no writes to the live DB, and the route's own SQL
is checked separately by widening `FINISHED_WINDOW_MS` and curling it. Screen was locked, so
`screencapture -R` fails ("could not create image from rect"); `screencapture -l <windowid>`
captures a window's own backing store regardless, and the id comes from
`CGWindowListCopyWindowInfo` via a four-line `swiftc` script. Chrome's
`--blink-settings=preferredColorScheme=1` forces light mode without touching the OS appearance
or the app's own `localStorage`, which is how the light-theme pass got done.

## The command palette — ⌘K, and why so little of it is in the component (2026-08-20)
`components/CommandPalette.tsx` + `lib/command-palette.ts` (+ specs). Decisions worth not
relitigating:

- **A client component may only `import type` from `lib/search.ts`.** That module opens the
  database at import time, so *one* value import — even a constant as small as
  `MIN_QUERY_LENGTH` — pulls `better-sqlite3` into the browser bundle. Which is why the palette
  does **not** re-declare the minimum query length: it sends whatever was typed and reads
  `tooShort` off the response. That field exists for exactly this, the endpoint answers it in
  under a millisecond without touching SQL, and the alternative is a duplicated constant that
  can silently drift from the one the server enforces. Same trap as `lib/pm-spec.ts` and
  `lib/update-ui.ts`'s `import type`.
- **The dialog body is an inner component mounted only while open.** A reopened palette must
  have an empty query and the highlight back at the top; doing that as a reset would be
  `setState` in an effect (a hard error here), and doing it in render is a side effect in
  render. Mounting fresh gives it for free — the same reasoning as `DiffModal`'s `key={path}`
  child. Measured: reopening really does show an empty field.
- **⌘K is ignored while another `[role="dialog"]` is up.** `Modal` puts its Escape handler on
  `document`, so a palette opened over the backlog's Add-item dialog means one Escape closing
  both and two focus traps fighting over one Tab. Verified by opening that dialog and pressing
  ⌘K: still exactly one dialog, still the other one.
- **Two staleness guards, because they cover different failures.** `AbortController` stops the
  in-flight request for a query that no longer exists; comparing the **echoed `q`** catches a
  reply that lands anyway. And a third thing that looks redundant but isn't: emptying the field
  clears the held results *in the change handler*, or typing → clearing → typing something new
  would render the first query's hits under the third one.
- **A keyword matches by prefix; visible text matches anywhere.** Found by a spec, not by
  thinking: `theme` carried the keyword `appearance`, so typing `app` to reach a project called
  `app-0` put all three theme rows above it. A keyword is a word you start typing, so a prefix
  is the honest test — substring matching lets an invisible term hijack a query aimed elsewhere
  (`token` on Settings would do it to `ok`).
- **The flat row index is computed in the pure module, not counted during render.** A
  `flatIndex += 1` inside the section map is rejected outright by
  `react-hooks/immutability`, and it's the right rejection: an off-by-one across groups is
  invisible — the highlight simply lands one row away from what Enter opens. `paletteSections`
  stamps each section's `start` **after** empty sections are dropped, and a spec walks every
  row asserting `flat[start + i] === entry`.
- **Row icons must be one flat record keyed by a string.** A `Map.get()` and a ternary chain
  are both rejected by `react-hooks/static-components` as "creating a component during render".
  `StatusBadge`'s `ICON[status] ?? Fallback` is the shape that passes.
- **`sr-only sm:not-sr-only` for the task status badge**, not `hidden sm:flex`. Measured across
  the breakpoint: below 640px the span is `position:absolute`, `clip-path:inset(50%)`, 1px wide
  — so "Awaiting change approval" stops taking 184px of a 320px row, while staying in the row's
  accessible name. `display:none` would have dropped the status from the name entirely. (Note
  for the next person measuring this: `getBoundingClientRect().width > 0` **cannot** tell
  `sr-only` from visible, because Tailwind's `sr-only` is 1px, not 0.)
- **A `listbox` may only contain options and groups**, so the "No matches" sentence sits
  *outside* it in the scroll container, and a capped group discloses itself **in its heading**
  (where it becomes part of the group's accessible name) rather than as a stray line among the
  rows.
- **Home/End are deliberately not hijacked.** APG lists them for a listbox, but this is an
  *editable* combobox and they move the text caret. ↑↓ are overridden (in a single-line input
  they'd jump to the ends of the text), and they **wrap** — `SegmentedControl.move` already
  does, so that's the house convention.
- **The mobile trigger is not a nicety.** A phone has no ⌘K, so without the icon in
  `MobileTopBar` the feature does not exist below `md`. The risk was that bar's 320px width
  budget, which `.fe/notes.md` says the `ActivityBadge` is what tips over — measured with the
  badge stubbed in: brand 122px (truncated to "Agent Con…") + 166px of controls = 320, no
  overflow. The brand is what gives, exactly as that note prescribes.
- **`⌘K` vs `Ctrl K` goes through `useSyncExternalStore`** with a server snapshot of `⌘K`, the
  `lib/theme.ts` shape. The value can never change, so `subscribeShortcutHint` returns a no-op
  unsubscribe — that's the point, not an omission. Rendering the wrong one and fixing it in an
  effect would be both a hydration mismatch and a state write in an effect.

**A `router.push` to the URL you are already on is a no-op, and that was a real bug here.**
"New task in *project*" pushes `/projects/<id>#new-task`. Pressed while already on that project's
page *and already at that hash*, nothing happened — the palette closed, the page did not move,
and the card stayed 591px off screen. The plain same-pathname case (no hash yet) scrolls fine on
its own, which is why this only shows up on the second press. `scrollToFragment` fixes it, and it
is deferred one frame **because `Modal` locks `body` scroll while open** — run synchronously it
fires before React commits the unmount that releases the lock, and the scroll is swallowed. On a
cross-page navigation the element doesn't exist yet, so it no-ops and the router does the work.
Raised as a maybe by the design review; the worst case turned out to be real, the easy case
turned out not to be. Both are measured.

**Verified in a real browser via the CDP driver** (see the note above), because every
interesting claim here is about focus or a breakpoint: focus lands on the field and returns
**to the sidebar trigger** on Escape (measured, not assumed); Tab cycles field ↔ close and
nothing else; ↑↓ wrap both ways with exactly one `aria-selected`; Enter navigates and closes;
the theme action changes `<html>` without navigating; no horizontal overflow at 320/390/768/1280
in both themes; and the empty / "keep typing" / API-error states each render their own copy with
the static rows still usable. Task rows were exercised by **patching `window.fetch` in the page
through CDP** rather than writing rows into the live database — the same instinct as the toast
work's scripted `emit()`, with no source change at all. One gotcha for the next person: pass
`prefers-color-scheme` to `Emulation.setEmulatedMedia` **explicitly for light too** — headless
Chrome's default here is dark, so a "light" pass that only omits the dark override silently
screenshots dark twice.

## The dashboard is the onboarding surface (2026-08-13)
`components/GettingStarted.tsx` — token → project → first task, `null` once all three hold.
Decisions worth not re-litigating:
- **It replaces `TokenNudge` on the dashboard**, and only there. The token is step 1, so
  rendering both put the same sentence on screen twice. `TokenNudge` still stands alone on
  project detail and backlog, where a full checklist would be off-topic.
- **One CTA at a time**, on the first incomplete step. Three buttons is not a checklist.
- **The three nouns are defined in the card's own intro**, not spread across three pages —
  that was the actual audit finding (a new user had to reverse-engineer what an "agent" was).
  The page headers on `/agents`, `/projects` and `/tasks` now each restate their own noun.
- State is `sr-only` text ("Done: ", "Next: ", "To do: ") before each step title, because a
  green check and a tinted row are colour-only signals.
- It takes `hasProject`/`hasTask` as props rather than querying — the dashboard has already
  run both queries, and a server component doing them again is two wasted round-trips.
  (`getCurrentUser()` *is* called twice, but it's `cache()`-wrapped in `lib/auth.ts`, so it
  dedupes per request.)

Two layout traps this hit, both worth knowing generally:
- **The warn tone had to go on the row, not the card.** `card` already contains
  `border border-line`, so `${card} border-warn-line` puts two same-specificity border-colour
  utilities on one element and the *emitted CSS order* decides — not the class attribute's
  order. It happened to render correctly, which is worse than failing. Tone an element whose
  classes you own end to end.
- **`flex-wrap` doesn't wrap anything if a sibling can shrink to nothing.** The step rows are
  `flex flex-wrap` with a `min-w-0 flex-1` text column and a `shrink-0` button. Rather than
  wrapping the button, flexbox collapsed the text to a sliver — at 390px the explainer wrapped
  one word per line. The floor (`min-w-40`) is what forces the wrap; `min-w-0` is only right
  when the child is *supposed* to truncate.

## SSE for live task view
`TaskLiveView` uses `EventSource` (SSE) to stream task transcripts. The runner at `runner/server.ts` (Hono, port separate from Next.js) is the SSE source. The Next.js dev server and runner must both be running (`pnpm dev` starts both via `concurrently`).

## Dispatching a spec goes through its backlog item, and a failed lookup refuses (2026-08-14)
`FileModal`'s **Create task** used to `POST /api/tasks` directly, so the backlog item the
`.pm/tasks/` sync had already created for that same file stayed `todo` with no `linkedTaskId`
forever — the backlog only learned about runs started from its own Run button. It now resolves
the item first (`GET …/backlog`, which is also what *syncs*, so an on-disk spec is guaranteed
present and fresh) and dispatches via `POST …/backlog/<itemId>/run`. That route already owns
agent selection, the swe fallback, `/pm:plan` for a pm item, title passthrough (no Haiku rename)
and the already-running 409, so the client-side version of all of it became the fallback.

Three things are load-bearing:
- **`specSourcePath()` (`lib/pm-spec.ts`) matches exactly, never by suffix.** The scan keys
  `.pm/tasks/<request>/<file>.md` **relative to the project root**, but the modal's path comes
  from a clickable code span in agent markdown whose pattern also accepts a *nested*
  `web/.pm/tasks/…`. Suffix-matching a workspace member's spec would link the run to a different
  project's identically-named file. `member` is excluded before the lookup for the same reason.
- **A failed lookup is not "no item".** Folding them together means a transient error on that
  GET silently dispatches through a path with no duplicate check — a second concurrent agent
  session on the same spec, on the user's token, editing the same files. The lookup returns
  `none | item | failed` and `failed` refuses with a message; retrying is one click, undoing two
  live runs isn't.
- **The direct fallback's request text stays byte-identical to `backlogRequestText()`**, which
  `lib/backlog.test.ts` asserts, so the same spec produces the same run either way.

`ErrorAlert` (`components/ui/error-alert.tsx`) came out of this: the error-with-a-link pattern
had three hand-rolled copies. The link belongs **inside** the `role="alert"` paragraph — a
sibling is a second live-region announcement — and `dispatchErrorAction()` (`lib/ui.ts`) is the
shared 409→"Open it" / 412→"Open Settings" mapping, unit-tested.

**Verifying a modal without a browser:** temporarily render it from a component the page already
mounts (editing an existing file hot-reloads; a *new* route directory does not — see above),
seed its `useState` initial values, and curl the SSR'd HTML. **And check your viewport is real:**
macOS Chrome clamps a headless window to a **500px minimum layout width**, so `--window-size=390`
silently renders at 500 and crops — which looks exactly like a horizontal-overflow bug on every
page at once. The control that catches it is screenshotting a *centred* layout (`/signin`): if
it renders off-centre, the width is a lie, not the CSS.

## Syntax highlighting: lowlight, lazily, themed by class (2026-08-20)
`DiffModal` rendered raw diff text coloured by first character and `FileModal` showed code as
flat monospace. Both now share a highlighter. The decisions worth not relitigating:

- **lowlight (highlight.js) over Shiki, for three independent reasons.** It emits **class
  names**, so the theme is CSS and lives in `globals.css` with every other token — Shiki emits
  inline `style` from a bundled editor theme and cannot follow light/dark from our variables
  without a second mechanism. It returns a **hast tree**, so the viewers build React elements;
  highlight.js' own API returns an HTML *string*, which would mean `dangerouslySetInnerHTML`
  over file contents. And it is pure JS — Shiki needs a WASM regex engine, under a Next build
  already far off the public release train.
- **`lib/highlight.ts` is only ever reached through `await import()`**, and that is load-bearing,
  not tidiness: it statically pulls in all 22 grammars, which the bundler puts in **one ~120 KB
  chunk that no page's initial script list references** (verified by grepping the built chunks
  and the SSR'd HTML). Type-only imports of it (`import type { CodeLine }`) are erased and
  don't drag it back in — one keyword away from undoing the whole thing, same trap as
  `lib/update-ui.ts`'s `import type` from `lib/update-run.ts`.
- **`highlight.js` is a direct dependency even though lowlight pins it.** `lib/highlight.ts`
  imports `highlight.js/lib/languages/<x>` directly (registering 22 grammars rather than
  lowlight's `common` set of 37 — smaller, and `common` doesn't include `dockerfile`), and
  pnpm's strict layout won't resolve a transitive package. Those subpaths also ship **no type
  declarations**, hence `types/highlight-languages.d.ts`; note the `import` sits *inside* the
  `declare module` block, because a top-level import would make the file a module and a
  `declare module` in a module is an augmentation, which can't use a wildcard.
- **Highlighting is per *side of a hunk*, never per line.** Re-lexing each row independently
  colours a line inside a block comment as code. Each side of every hunk is concatenated and
  highlighted as one document, then split back by line count — which is why `hunkSides` exists
  and why a hunk contributing **zero** lines to a side must not push an empty string into that
  concatenation (it would add a phantom line and shift every later hunk by one; a new file,
  whose only hunk has no old side, is the common case).
- **The invariant the tests defend is that re-joining the tokens reproduces the input exactly.**
  A flattening bug doesn't look like a bug — it drops or duplicates a character mid-review and
  what's on screen still reads plausibly. Every highlighter test asserts the round trip before
  it asserts anything about colour.
- **Innermost class wins when flattening.** highlight.js nests (`hljs-subst` inside
  `hljs-string`); concatenating the ancestor chain would put two equal-specificity `.hljs-*`
  rules on one span and let emitted-CSS order pick the colour — the same trap as
  `GettingStarted`'s two border-colour utilities.
- **`--syn-*` reference their tokens (`var(--violet)`, `var(--ok)`, …) rather than restating
  the hex.** The first version copied the values; the design review correctly called that the
  project's own "hardcoded value a token already expresses" anti-pattern, one level down inside
  the token layer. Six of seven are tone/text tokens; only `--syn-type` is a new hue. Contrast
  was checked against **four** backgrounds per theme — `sunken`, `surface-2` and both diff row
  washes, which are *translucent* in dark mode and so composite over `sunken`. A syntax colour
  sits on a tinted row, not just on a card.

## The diff viewer: two views, one set of rows (2026-08-20)
- **The split view re-groups the rows the unified view already parsed** — it never diffs
  anything itself, so the two literally cannot disagree about what changed. `pairRows` zips a
  deletion run against the addition run that follows it; a test asserts no row is ever lost.
- **Wrap-around prev/next, not disabled buttons at the ends.** `disabled` drops focus to
  `<body>` when the focused element gets it (this project has now hit that three times —
  `UpdateBanner`, the backlog `Select`, here), so pressing Next through a file list by keyboard
  would dump you at the top of the page on the last press. The counter and the live region make
  the wrap obvious. Measured: focus stays on the button.
- **The fetching body is a `key={path}` child**, so navigating gets fresh state. The
  alternative — resetting `diff`/`err` when the prop changes — is `setState` in an effect,
  which this build hard-errors on. The nav buttons live in the stable parent, so the remount
  can't take focus with it.
- **A changed dialog name is not announced**, so an `sr-only aria-live="polite"` line says
  "File 6 of 17: <path>". It renders empty when there is nothing to navigate, so a single-file
  diff doesn't chatter.
- **Three caps, three different jobs, all disclosed on screen and none of them truncating
  content**: no highlighting past 200 KB (`CodeView`) or 3 000 rows (`DiffView`); no per-line
  rows past 5 000 lines in either. The row cap is the one that matters and it was a **blocking
  audit finding** — `DIFF_CAP` bounds a diff to 200 000 *characters, not lines*, so a file of
  many short lines fits under it while producing tens of thousands of rows, five elements deep
  and doubled in split view. Measured on a real 60 000-line diff: 3 DOM nodes instead of
  ~300 000. If you add a view here, give it the row guard too.
- **The old prefix-colouring `<pre>` is kept as `RawDiff` and is not dead code.** The diff
  endpoint can return text no git ever wrote — `untrackedDiff` synthesizes its own — so
  `parseUnifiedDiff` returning `null` has to land somewhere. Everything it *does* recognise is
  pinned by fixtures taken from the real endpoint: mode-only changes with no hunks, both binary
  wordings, `@@ -0,0 +1 @@` with the count omitted, submodule pointer lines, `\ No newline`,
  a diff cut mid-hunk, an empty new file and a deleted empty file.
- **`+`/`−` are rendered characters, not just backgrounds**, so add/delete is never colour
  alone; they are `select-none` so copying a block gives you the code. Line numbers are
  `text-fg-faint` (a sighted user reads them) but `aria-hidden` (announcing a number before
  every line is noise).
- **The scrollable body is `role="region" tabIndex={0}`.** A scroll box with nothing focusable
  inside it cannot be scrolled by keyboard at all (WCAG 2.1.1). It becomes the modal's last tab
  stop, which `Modal`'s trap picks up correctly.

**Operational: this change adds dependencies, so the Docker dev flow needs `pnpm dev:clean`
first.** `node_modules` lives in a named volume; a container started before this lands has
neither `lowlight` nor `highlight.js` and will fail to build. (The auditor hit exactly this.)
