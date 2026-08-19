# Test scenario: the update banner says what happened

_Task: a refused update is an unmissable state, and a real failure is reported with its reason the
moment it's known — `.pm/tasks/20260817-191237-fix-update-button/02-frontend-update-banner-ux.md`
· 2026-08-18_

## What changed, in one line
`components/UpdateBanner.tsx` went from four independent booleans to six named states, and now
consumes the `run` record that `GET /api/updates` gained in the backend half of this task.

## Setup / preconditions
The banner only renders for an **installed** app with a newer release published — `packaged` is
false in a dev checkout, so on `pnpm dev` it renders nothing at all (correct, and the reason the
states below need one of the two harnesses).

**Harness A — a throwaway install (the real thing, and the only way to see a genuine failure).**
```sh
export CC_HOME=/tmp/cc-banner CC_PORT=3101 CC_RUNNER_PORT=4419
# install an *older* release so an update is pending, then:
sh $CC_HOME/app/infra/release/control-center.sh start
```
Then open <http://localhost:3101>. To force each state, write `$CC_HOME/run/update.status` by hand
(`state=`, `pid=`, `from=`, `target=`, `startedAt=`, `endedAt=`, `message=` — one per line, unix
**seconds**) and put a few lines in `$CC_HOME/logs/update.log`. `state=running` with a `pid` of a
dead process is what the reader reports as `crashed`.

**Harness B — the states without an install.** Temporarily seed the component's initial
`status`/`phase` and open the dashboard (the pattern in `.fe/notes.md`: edit an existing file, it
hot-reloads; a *new* route directory does not). Verified this way for the screenshots below.

Note on width: macOS Chrome clamps a headless window to a **500px minimum layout width**, so
`--window-size=390` silently renders at 500. Use a real browser's device toolbar for 320–390px.

## 1. Nothing changed for the common case
1. Open the app with an update pending and no attempt on record.
   - **Expected:** the same slim **info-tone** bar as before — `↑ Version 0.7.0 is available — you're
     on 0.6.0.` then **Update now**, *Release notes*, ×. One line. No new visual weight.
2. Press ×, reload.
   - **Expected:** gone, and it stays gone for that version only (`cc:update-dismissed` in
     `localStorage`). Bump the pending version and it speaks up again.

## 2. A refused update — the headline change
1. Dispatch a task and **leave it waiting at a gate** (`awaiting_proposal` counts as active — that
   is the whole point; it's the most common state on this platform). Now press **Update now**.
   - **Expected:** the bar turns **warn-toned** (amber wash, `TriangleAlert`) and grows to two
     lines:
     `**1 task is still running**` / `Updating restarts the server, which ends it mid-run and loses
     its progress. Wait for it to finish, or update anyway.` followed by a **Review running tasks**
     link. The actions become **Update anyway** (danger-toned) and **Not now**. The × is gone.
   - **This is the acceptance criterion:** it must be impossible to read this as "the button did
     nothing". A same-coloured bar with a relabelled button is the bug.
2. Check the wording with more than one task running.
   - **Expected:** `3 tasks are still running` … `ends them mid-run and loses their progress. Wait
     for them to finish` — no "1 tasks", no missing spaces between words.
3. Click **Review running tasks**.
   - **Expected:** `/tasks`, so you can go and let them finish.
4. Come back and click **Not now**.
   - **Expected:** straight back to state 1 (the plain notice, × available again) — not dismissed,
     not gone.
5. Click **Update now** → **Update anyway**.
   - **Expected:** it proceeds. The refusal needed a second, deliberate click and nothing else.
6. **Keyboard — the one that regressed twice.** Tab to **Update now**, press Enter, and *don't
   touch anything*. Watch the focus ring while the request is in flight and when the refusal
   lands.
   - **Expected:** the ring stays on that button the whole way through — while it's the disabled
     "Updating…" spinner, and when it becomes *Update anyway*. It must never end up on nothing.
     (Same element isn't enough: `loading` disables it, and disabling a focused element drops
     focus to `<body>`, so the phase change takes focus back after the commit.)
   - **Then press Tab once:** focus moves to *Not now*.
7. **Keyboard:** with focus on *Not now*, press Enter.
   - **Expected:** the bar returns to the plain notice **and focus is on Update now** — the button
     that just vanished handed focus on rather than dropping it.
   - Counter-check: click *Update now* with the **mouse**, then move focus elsewhere (Tab into the
     sidebar) while the request is in flight. When the refusal lands, focus must stay where *you*
     put it — the banner only reclaims focus it took.

## 3. A real failure, reported with its reason
Break an update on purpose (harness A): the cheapest is a `SHA256SUMS` mismatch, or point `CC_REPO`
at a fork with no such release. `apply_update()` does download → checksum → `pnpm install` →
`next build` **all before it stops the server**, so the server is still up and answering.
1. Press **Update now** and watch.
   - **Expected:** "Updating to 0.7.0…" for a moment, then — **within ~2 seconds of the failure,
     not after six minutes** — the bar turns **danger-toned** and reads:
     `**The update to 0.7.0 didn't finish**` / `Checksum mismatch for control-center-0.7.0.tar.gz —
     refusing to install. You're still on 0.6.0.`
   - The reason is the script's own words; only its first letter is capitalised. A message that
     *starts* with a URL (`http://localhost:7373 never answered…`) must stay lowercase.
2. Click **Show the update log**.
   - **Expected:** an inset panel on `bg-sunken` (the same surface as every other transcript/code
     block in the app) with the last ~12 lines, monospaced, scrolling at `max-h-48`, wrapping
     rather than overflowing sideways. The label flips to **Hide the update log** and the chevron
     flips with it. The log's path sits beside the toggle in mono and **wraps** — the filename at
     the end must be readable without hovering for a tooltip.
   - The log is plain text: no markdown is rendered, and a line containing `<b>` or `&amp;` appears
     literally.
3. Click **Try again**.
   - **Expected:** it starts a fresh attempt (and refuses with state 2 if a task is running now).
4. Reload the page while the failed record is still on disk.
   - **Expected:** the failure is **still shown**, reason and all. That run is over; nothing else
     will ever mention it.
5. Complete the update successfully, then reload.
   - **Expected:** no banner (you're on the new version), and the old failure does *not* reappear —
     `stale` suppresses a failure whose target is already installed.

## 4. It never even started
1. Stop the runner/DB or otherwise make `POST /api/updates/apply` fail (in a checkout it answers
   400 by design).
   - **Expected:** danger-toned `**Couldn't start the update**` with the server's sentence under it
     — and **no** "Show the update log" link, because nothing ran and there is no log to open.

## 4b. Already up to date
1. Record `state=up-to-date` and press **Update now** (or let an attempt conclude that way).
   - **Expected:** an **`ok`-toned** (green) bar with a check mark — being current is the good
     outcome — reading `You're already on the latest version (0.6.0)` and a single **Dismiss**
     action. The top-right × is *absent* here: it would be the same action twice in one bar.
   - It must stop polling immediately rather than sitting there for six minutes, which is what the
     old fixed timeout did with this case.

## 5. Timeout — now only when nothing can be learned
1. Write `state=running` with a live pid and a current `startedAt`, press **Update now**, and wait
   six minutes with the server **up**.
   - **Expected:** warn-toned `**The update is taking longer than expected**` / "It has been going
     for several minutes without reporting an outcome. It may still finish on its own." plus the log
     path and a **Check again** button. It must **not** tell you to quit — the update may be mid
     `next build`.
2. Press **Check again**.
   - **Expected:** it resumes watching (back to "Updating…") rather than sitting on a dead end.
3. Now kill the server mid-update and wait out the six minutes.
   - **Expected:** `**The server hasn't come back**` / "…Quit Agent Control Center and open it again
     — it picks the update up on launch." This is the only state that says that, and it's true:
     `control-center start` applies a pending update on the way up.

## 6. An update someone else started
1. With an attempt genuinely in flight (`state=running`, live pid), open a **second** window.
   - **Expected:** the new window shows "Updating to 0.7.0…" with a spinner, not **Update now** —
     and reports the same outcome when it lands. No × while it's applying.

## 7. Success
1. Let a real update finish.
   - **Expected:** the page reloads itself once the server answers with a **different version**
     (not merely when it answers again), and the banner is gone.

## Responsive
1. **1280px** — every state is icon + message on the left, actions on the right. Idle stays one line.
2. **768px** — the same; the failure's log path wraps rather than pushing the buttons off.
3. **500px and below** (device toolbar for 390/320) — for the notice states the message takes the
   full first line and the actions wrap **underneath** it; the icon stays on the headline's line,
   never stranded on a row of its own. No horizontal scrollbar, no text collapsing to one word per
   line (that was the `min-w-40` fix — the same trap `GettingStarted`'s rows hit).
4. Open the log panel at 390px.
   - **Expected:** it fits the column, scrolls vertically, and wraps long lines.

## Dark mode
Run through states 1–5 with the theme toggle on **dark**, then on **light**, then **system**.
- **Expected:** every state legible in both — amber on the warn wash, red on the danger wash, the
  log panel's `bg-sunken` reading as an inset panel rather than a hole. No `dark:` classes exist in
  this component; it's all semantic tokens, so nothing should need a second look.

## Accessibility
1. With a screen reader on (VoiceOver ⌘F5), press **Update now** on an install with a task running.
   - **Expected:** the refusal is announced politely, as **one** message (headline, then the
     explanation, then the link) — not as two separate live-region events, and not twice.
2. Tab through the whole bar in the failure state.
   - **Expected:** order is *Show the update log* → **Try again** → *Release notes* → ×. Every stop
     has a visible focus ring. The disclosure reports `aria-expanded`, and toggling it does not
     re-announce the whole message.
3. Check the × in each state.
   - **Expected:** its accessible name names the version ("Dismiss the update notice for version
     0.7.0"). It is absent while applying, absent in the refused state (where *Not now* is the way
     out), and absent when already up to date (where the primary action *is* **Dismiss** — one bar
     should not carry the same action twice).
4. Confirm no state is signalled by colour alone — each carries an icon and a headline that says
   the same thing in words.
