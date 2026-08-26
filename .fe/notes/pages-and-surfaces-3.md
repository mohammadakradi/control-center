# pages and surfaces

Per-surface notes: what each page is for and the decisions behind it.

Part 3 of 3.

<!-- Split out of a single 79 KB `.fe/notes.md` on 2026-08-24, which was read in full at the start of every request (frontend rule 10). Entries are verbatim; only this header is new. -->

## The update banner has states, and the copy for them is unit-tested (2026-08-18)
`components/UpdateBanner.tsx` held four independent booleans (`applying`, `stalled`, `error`,
`activeTasks`) and derived its wording from the combinations. That is *why* it had the two bugs
the pm task found, so the fix is one discriminated `Phase` union (`idle` · `applying` · `blocked`
· `failed` · `stalled` · `uptodate`) plus `lib/update-ui.ts` for everything pure.

- **A refused update needed to be a state, not a relabel.** `POST /api/updates/apply` 409s
  whenever a task is in an active status — which includes a task merely waiting at a gate, the
  most common thing here — and the old bar answered by renaming its own button "Update anyway"
  and printing the reason beside other copy. Same colour, same shape: the first click read as
  nothing happening. Now the bar changes tone, leads with the count, says what pressing on costs,
  and offers *Not now*.
- **The failure reason arrives in ~2s, not at a 6-minute timeout**, because
  `infra/release/control-center.sh`'s `apply_update()` does download → checksum → `pnpm install`
  → `next build` **all before `stop_all`**. The server is still answering for the failures that
  actually happen, so the poll reads `run.state` and shows `die`'s own words. The timeout is now
  only for "nothing can be learned", and it splits on whether the *last* poll got a reply:
  quit-and-reopen is said only when the server really went away (and it's true — `start` applies
  a pending update on the way up).
- **`stale` is honoured for a failure and must not be for `up-to-date`.** An up-to-date attempt
  targets the version it found installed, so `stale` is true by definition there; checking it
  discards the one record that explains why nothing happened.
- **A record keeps its `startedAt` from `running` through to `failed`**, so "is this record mine?"
  can't be answered by the stamp alone. `isFreshRun` compares against the record that was there
  *before we started an attempt*, and the baseline is deliberately `null` when we're **adopting**
  one already in flight (page load with `state=running`, or a 200 carrying `alreadyRunning`) —
  otherwise its own terminal write compares as unchanged and the failure is never reported.
  Two unknown stamps compare as unchanged on purpose: waiting ends in a message about waiting,
  guessing wrong invents a failure that never happened.
- **The primary action is the same element in the same slot in all six states.** Every transition
  is reached by pressing it, and rendering a *different* element there unmounts the button under
  the keyboard user's focus. This is why the visual "unmissable" work is tone + icon + headline
  rather than swapping controls around.
- **Same element is necessary and not sufficient — `loading` disables it, and disabling the
  focused element drops focus to `<body>`.** So pressing "Update now" by keyboard left focus
  nowhere for the length of the request, and the outcome then landed on a control nobody was
  standing on. Entering `applying` now records whether that button held focus, and an effect
  takes it back **after the commit** (focusing in the same tick hits the still-disabled element
  and silently does nothing) and **only if focus is on `document.body`** — anything else claimed
  it, that's the user's business. Same class of bug as the *Not now* button, which removed itself
  on its own click and now hands focus to the primary slot before it goes.
  **I found this by measuring, not reading.** Static reasoning said the element persists, so
  focus persists — and it was wrong. The cheap harness: temporarily render the component with a
  seeded phase, `focus()` + `click()` the button from an effect, write `document.activeElement`
  into `document.title`, and read it back with `chrome --headless --dump-dom | grep '<title>'`.
  It reported `BODY` before the fix and `BUTTON:Try again` after. Worth reaching for whenever a
  claim is about focus, because nothing else in this repo can catch it.
- **`variant="warn"` is `bg-warn-soft`** — the same wash as the warn bar — so "Update anyway"
  disappeared into it. It's `danger`, which is also the honest label for ending three live agent
  sessions. Check a variant's own background before putting it on a tinted bar.
- **`ErrorAlert` is deliberately not used here**, though the link-inside-the-sentence rule is:
  it pins `text-danger` (documented: callers must not override it), which is wrong on a warn
  wash, and its `role="alert"` nested inside this bar's `aria-live` region is two announcements
  of one message.
- **`min-w-0 flex-1` on the message collapsed it to one word per line** beside the `shrink-0`
  buttons at 500px. `min-w-40` is the floor (`GettingStarted` hit this first), and the notice
  states also take `basis-full sm:basis-auto` so the actions wrap underneath — otherwise a
  headline, a reason and a log panel share a 160px column while the buttons keep the line.
  Nest the icon *with* the message, or `basis-full` leaves it stranded on a row of its own.
- **Copy lives in `lib/update-ui.ts` because it's testable**: 1-vs-N agreement ("1 task is" vs
  "3 tasks are"), the `{expr}`-eats-the-space trap, and `sentenceCase` — `die`'s messages are
  written to follow `error: ` so they start lowercase, and under a headline that reads as a typo.
  The one message it must not touch starts with a URL (`"$URL never answered…"`).
- `lib/update-ui.ts` imports the record's type with **`import type`** from `lib/update-run.ts`,
  which reaches for `node:fs`. Type-only imports are erased, so nothing Node-side follows it into
  the client bundle — but it is one keyword away from a broken build.
- **Verifying it needs a harness**: `packaged` is false in a checkout, so the banner renders
  nothing on `pnpm dev`. Seed the initial `status`/`phase` (see `.fe/test-scenarios/update-banner-states.md`).
- Two smaller review corrections worth keeping: a log/transcript panel is **`bg-sunken`** (what
  the surface table assigns it, and what `GitControls`, `DiffModal`, `TaskLiveView` and
  `Markdown`'s code blocks all use) — `bg-surface` was drift; and a path gets **`break-all`, not
  `truncate`**, because `truncate` ellipsises the *end*, hiding the filename and leaving only a
  `title` attribute that no keyboard and no screen reader reaches.
