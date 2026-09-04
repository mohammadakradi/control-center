# Test scenario: the report card's fix-task offer — real target, honest reasons

_Task: "Create fix task" now dispatches to a command the agent actually has (resolved
server-side from the installed agents' command lists), a refused create shows its reason, and
the follow-up callout no longer fires on work the report says it already filed. · 2026-09-04_

## Setup / preconditions
The callout only renders on a **finished** task whose transcript contains a **report** event, so
this needs seeded data rather than a fresh run. Use a throwaway DB — never the live
`data/platform.db` (it has corrupted twice; see `.fe/notes/verification.md`).

1. Build once: `pnpm build`
2. Create the schema in a scratch file:
   `npx drizzle-kit push --dialect=sqlite --schema=./lib/db/schema.ts --url=/tmp/fixtask.db --force`
3. Seed, with `better-sqlite3` from this repo:
   - three `agents` rows — `pm` (commands `onboard`, `plan`), `swe` (`fix`, `onboard`, `task`),
     `fe` (`audit`, `fix`, `task`). `commands` is a JSON column of `{name, description}`.
   - one `projects` row pointing at any real folder,
   - one `tasks` row with `agent_id` = the **pm** agent, `user_id = 'user_local'`,
     `status = 'done'`,
   - one `task_events` row (columns are `id, task_id, ts, type, payload` — there is no
     `created_at`) of type `message`, whose payload text is a pm report ending in `[[DONE]]` and
     containing all four of these lines:
     ```
     ## Findings
     [High] The amber in the callout is hardcoded.
     Recommendation — filed the two out-of-scope findings as bli_9f2a41 so they're tracked.
     I recommend replacing the hardcoded amber with a token.
     ```
4. Start it: `PLATFORM_DB=/tmp/fixtask.db npx next start -p 3111`
   → open <http://localhost:3111/tasks/{the seeded task id}>. No sign-in needed — no session
   makes you `user_local`, which is why the task is seeded to that owner.

## Happy path
1. Scroll to the report bubble at the bottom of the transcript.
   - **Expected:** an amber-toned callout (warn tone: soft amber fill, amber hairline border)
     headed **"This report flags follow-up work"**.
2. Read the sub-line under that heading.
   - **Expected:** **"A fix task starts a fresh `/swe:fix` run to deal with it."** — it names
     `/swe:fix`, *not* `/pm:task`. This is the fix: the report is from **pm**, which has no
     `task` and no `fix` command, so the offer routes to an agent that implements.
3. Read the listed reasons.
   - **Expected:** exactly three, one per kind — a *Findings section* (`Findings`), a *Severity
     callout* (`[High] …`), and a *Recommendation* (`I recommend replacing the hardcoded
     amber…`).
   - **Expected:** the line **"Recommendation — filed the two out-of-scope findings as
     bli_9f2a41…"** does **not** appear as a reason. That is work already recorded elsewhere;
     before this change it was the flagged reason and the callout was unearned.
4. Hover the **Create fix task** button.
   - **Expected:** tooltip "Start a `/swe:fix` run that works through the follow-ups listed
     above" — the copy names the run that is about to start, so nobody clicks blind.
5. Click **Create fix task**.
   - **Expected:** the label becomes "Creating…", then the browser navigates to the new task's
     page, which is a **`/swe:fix`** run whose request text begins "Address the findings from
     the following report…".

## Routing variants (the point of the change)
1. Re-seed the task's `agent_id` to the **swe** agent and reload.
   - **Expected:** the copy and tooltip say **`/swe:fix`** — an agent that has `fix` uses its
     own, it is not handed off.
2. Delete the `swe` row, keep `fe`, put the task back on **pm**, reload.
   - **Expected:** **`/fe:fix`**. The fallback walks the installed implementers rather than
     assuming swe exists.
3. Delete both `swe` and `fe`, leaving only **pm**, reload.
   - **Expected:** the callout **still renders, with all its reasons**, but there is **no
     button at all**, and the sub-line changes to *"Nothing here is required — it's what the
     report left undone, in its own words."* No dead button, and the reasons still stand on
     their own.

## Two reports in one transcript (the state must not be shared)
A continued task ends **several** turns with a report, so more than one card can carry this
offer. Seed a **second** `task_events` message row for the same task, also ending `[[DONE]]`,
with its own findings (e.g. `[Medium] The second turn left the spacing scale untouched.` and
`I recommend folding the raw margins into the token layer.`) and reload.

1. Look at both report cards.
   - **Expected:** each has its own callout, its own reasons (the `[High]` one on the first,
     the `[Medium]` one on the second) and its own **Create fix task** button.
2. Run the instance with **no `SECRETS_MASTER_KEY`** so the dispatch is refused, and click the
   button on the **first** card only.
   - **Expected:** the error line appears under the **first** card *and nowhere else*. The
     second card's button does not spin, does not disable, and grows no error. Counting
     `document.querySelectorAll('[role="alert"]').length` should give **1**, not 2 — the
     failure of one conversion must not be announced as every report's failure.
3. Toggle the transcript's "show activity" control and click again.
   - **Expected:** the error still lands on the card you clicked. (The in-flight/error state is
     keyed by the report's own text, not by its position — the visible list is filtered, so
     positions renumber when activity is toggled.)

## Responsive
1. Resize to ~390px (device toolbar, or Chrome DevTools' iPhone preset).
   - **Expected:** the callout's heading, sub-line and reason list wrap; the quoted evidence
     wraps rather than pushing the page sideways (`document.scrollWidth` stays equal to
     `clientWidth`, i.e. no horizontal scrollbar appears); the button stays a comfortable tap
     target and doesn't overlap the reasons.
2. Resize to ≥1280px.
   - **Expected:** the callout sits inside the report bubble at its normal width; the button
     sits below the reason list, left-aligned.

## Dark mode
1. Flip the theme (sidebar theme control, or set the OS to dark — the app defaults to
   *system*).
   - **Expected:** the callout uses the dark warn tokens (dark amber wash, legible amber text);
     no light-mode panel leaks through, and the reason evidence stays readable. Nothing in this
     callout is a raw palette shade or a `dark:` variant, so both themes come from the same
     tokens.

## Accessibility
1. Tab through the report bubble with the **keyboard only**.
   - **Expected:** **Create fix task** is reachable in reading order (after the report text,
     before whatever follows), shows a visible focus ring, and fires on Enter/Space.
2. Trigger a **refused** create and listen for it. The cheapest way: run the same instance with
   **no `SECRETS_MASTER_KEY`** in the env — every dispatch is then refused —
   `env -u SECRETS_MASTER_KEY PLATFORM_DB=/tmp/fixtask.db npx next start -p 3111`. Click the
   button.
   - **Expected:** the spinner resets **and** a red error line appears directly under the
     button with the server's real reason ("The server is missing SECRETS_MASTER_KEY, so stored
     tokens can't be read…"). It carries `role="alert"`, so a screen reader announces it
     without moving focus. Before this change the button just silently un-pressed itself and
     read as broken.
3. Check the callout isn't signalling by colour alone.
   - **Expected:** the amber tone is decoration — the heading text ("This report flags
     follow-up work") and each reason's label ("Recommendation", "Severity callout") say the
     same thing in words.

## Edge / failure cases
1. Seed a report whose only follow-up-ish line is settled, e.g. *"Recommendation — filed the
   two out-of-scope findings as bli_9f2a41 so they're tracked."* with no findings heading and no
   severity tag.
   - **Expected:** **no callout at all.** Nothing is outstanding, so nothing is flagged.
2. Seed a report containing a `## Recommendations` **heading** whose body says the work is
   already filed.
   - **Expected:** the callout **does** appear, citing the heading. This is deliberate and
     pinned by a spec: a section heading is a structural claim about the report, and the
     matching is per-line by design — it does not look ahead at the lines beneath a heading.
3. Stop the server, then click **Create fix task**.
   - **Expected:** "Couldn't reach the server." under the button, not a stuck spinner.
4. Seed a report line with bidirectional control characters around the evidence
   (e.g. `U+202E`).
   - **Expected:** the quoted evidence renders with those characters stripped and reads
     left-to-right. Report text is agent-authored and can be steered by whatever the agent
     read, so it is never rendered as trusted markup.

## What success looks like
On a pm report the offer names and starts a `/swe:fix` run — a command that exists and whose
job is exactly this — instead of the `/pm:task` that could never have run; where nothing
installed can take the work the callout keeps its reasons and drops the button rather than
offering a dead one; a refused create says why, out loud; and a report that already filed its
follow-ups no longer wears an amber banner it didn't earn. Everything renders from the existing
warn/danger tone tokens, so light, dark, mobile and desktop all come out consistent with the
rest of the app.
