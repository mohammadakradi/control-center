# Test scenario — global toast & attention system

_Feature: a task reaching an approval gate, or finishing, raises a dismissible card linking to
it, from anywhere in the app._
_Files: `components/Toaster.tsx`, `lib/toast.ts`, `lib/task-toasts.ts`, `lib/active-tasks.ts`,
`app/api/tasks/active/route.ts`, `app/(app)/layout.tsx`._

## What it should do in one line
While you are on any page, a run that needs your approval or that has just finished announces
itself in the bottom-right corner, with a link straight to it — and says nothing about the run
whose page you are already looking at.

---

## Part A — the real thing, with a real agent run

The honest end-to-end path. Needs an Anthropic token configured (Settings) and costs one small
model call.

1. Dispatch any task from a project page — `/swe:task` or `/fe:task` with a trivial request is
   enough. Note its title.
2. **Immediately navigate away** — go to `/projects`, `/usage`, anywhere but the task page.
3. Wait. Within ~5 seconds of the agent reaching its proposal gate, a card should appear in the
   **bottom-right**:
   - an amber **"Awaiting proposal approval"** badge,
   - the task's title underneath, on at most two lines,
   - the project name with a folder icon,
   - an **✕** dismiss button top-right.
4. **Click the title.** You should land on `/tasks/<id>`, and the card should be gone.
5. Approve the proposal there. Navigate away again. When the agent reaches the change-report
   gate, a new card should appear reading **"Awaiting change approval"**.
6. Answer it and let the run finish while you are on another page. The card should now read
   **"Done"** with a green badge — **in the same card position**, not as a second card
   underneath.
7. **Leave it alone for two minutes.** The "Done" card must still be there. It is not on a
   timer; only you dismiss it.

**Expected count check:** at no point should there be two cards about the same run.

---

## Part B — every state, without spending anything

Real gates are slow and cost money, so drive the states directly. This does **not** write to
the database.

In `lib/active-tasks.ts`, inside `poll()`, temporarily add after the existing
`if (res.ok) emit(...)` line:

```ts
{
  const g = globalThis as Record<string, unknown>;
  const step = ((g.__toastStep as number) ?? 0) + 1;
  g.__toastStep = step;
  const mk = (id: string, status: string, name: string | null, project: string) => ({
    id, status, name, project, createdAt: Date.now(),
  });
  const LONG = "Migrate the legacy webhook receiver onto the new queue and backfill the last 30 days of events";
  const S: Record<number, unknown> = {
    2: { total: 1, tasks: [mk("task_11111111", "awaiting_proposal", "Add invoice approval flow to the billing settings page", "platform")], finished: [] },
    3: { total: 2, tasks: [mk("task_11111111", "awaiting_report", "Add invoice approval flow to the billing settings page", "platform"), mk("task_22222222", "running", LONG, "fe-agent")], finished: [] },
    4: { total: 1, tasks: [mk("task_44444444", "awaiting_report", "A fourth run, so the stack cap and Dismiss all show up", "platform")], finished: [mk("task_11111111", "done", "Add invoice approval flow to the billing settings page", "platform"), mk("task_22222222", "failed", LONG, "fe-agent"), mk("task_33333333", "done", null, "control-center")] },
  };
  if (S[step]) emit(parseActiveTasks(S[step]));
}
```

Each poll advances one step, so just watch `/projects` for ~25 seconds.

| At | Expect |
|---|---|
| **step 1** (first poll, ~0s) | **Nothing.** The first snapshot is a baseline — no toast storm on page load. |
| **step 2** (~5s) | One card, amber **"Awaiting proposal approval"**. `ActivityBadge` shows "1 in progress". |
| **step 3** (~10s) | **Still one card**, now reading **"Awaiting change approval"**, in the same position. The `running` task raises nothing. Badge shows "2 in progress". |
| **step 4** (~15s) | Four cards: **Done**, **Failed**, **Done** (this one titled *no description* in faint grey), **Awaiting change approval**. A **"Dismiss all"** button appears below them. |
| **step 5+** (~20s) | The gate card (`task_44444444`) **disappears** — it left the gate. The three terminal cards **stay**. |

Then:
- Click one **✕** → only that card goes.
- Click **Dismiss all** → all of them go, and the corner is empty.
- **Click in the empty corner where the cards were** — you must be able to click the page
  content underneath. (If a click is swallowed, `pointer-events-none` on the container has
  regressed.)

**Remove the temporary block afterwards** and confirm `git diff lib/active-tasks.ts` shows only
the intended changes.

---

## Part C — suppression: the page you're on

With the Part B block still in place:

1. Open `/tasks/task_11111111` directly (it 404s — that's fine, the layout still runs).
2. Reload and watch. When step 2 fires, **no card should appear** for `task_11111111`.
3. Navigate to `/projects`. Still **no card** for it — a suppressed event is not replayed later;
   it was not a new transition.
4. Step 4's other runs (`task_22222222`, `task_33333333`, `task_44444444`) **should** raise
   cards normally.

---

## Part D — responsive

Resize or use device emulation. The container is `inset-x-4 bottom-24` →
`sm:inset-x-auto sm:right-4 sm:w-96 md:right-6 md:bottom-6`.

| Width | Expect |
|---|---|
| **375px** | Cards span the full width minus the 1rem page gutters. They sit **clear above the fixed bottom tab bar** — no overlap with the tab icons, and the bar stays tappable. |
| **420px** | Same. The long title wraps to two lines and clips with an ellipsis (never three lines, never overflowing the card). |
| **640px** (`sm`) | Cards become a fixed 384px column pinned to the right edge. |
| **768px** (`md`) | Column moves in slightly and drops to 1.5rem from the bottom. The tab bar is gone. Check the card does **not** cover `PageHeader` actions — go to `/usage` (range switcher) and `/backlog` ("Add item"), which live at the *top*, and confirm no collision with `ActivityBadge`'s sticky top-right strip either. |
| **1440px** | Comfortable corner placement, no layout shift on the page behind (the container is `fixed`, so nothing reflows when a card arrives). |

Also check, with all four cards showing:

- **"Dismiss all" is still on screen** — it is the escape hatch, and it is an opaque
  `secondary` button, so it must stay readable over whatever page content is behind it.
- **Rotate to landscape** (or make a desktop window ~500px tall). The stack should **scroll**
  rather than clipping its topmost card off screen — the oldest card sits furthest from the
  bottom, so without the scroll container the longest-pending gate is what you'd lose. Confirm
  each card's shadow still looks soft on all four sides (no hard vertical shear line where the
  scroll container clips).
- A four-card stack **does** temporarily reach up over `PageHeader`-level controls on a short
  desktop window (e.g. the "Add project" button on `/projects` at ~820px tall). That is accepted:
  unlike `ActivityBadge` — which got its own sticky row precisely because it is *permanent* —
  toasts are transient and dismissible. One or two cards never get near it.

---

## Part E — dark mode and light mode

Toggle via the sidebar footer control (or the mobile top bar icon), and check **both**:

- The card is an **opaque** surface in both themes. Scroll the page behind it — page content must
  **not** show through the card. (This is the specific regression the `bg-surface` choice guards:
  the `*-soft` tone backgrounds are translucent in dark mode.)
- The border tint reads correctly: amber for a gate, green for Done, red for Failed.
- **"Dismiss all"** is readable in both themes over whatever page content is behind it (it is a
  `secondary` button with its own surface, not a transparent one).
- The status badge text is legible at both themes — it is the same `StatusBadge` used in every
  task list, so it should look identical to a row on `/tasks`.

---

## Part F — accessibility

- **Keyboard:** Tab through the page with a card showing. You should reach the card's **title
  link** and its **dismiss button**, both with a visible focus ring. Enter on the link
  navigates; Space/Enter on the dismiss button removes the card.
- **Dismiss button name:** with a screen reader (VoiceOver: ⌘F5), the ✕ should announce as
  *"Dismiss notification: &lt;task title&gt;"* — not just "button".
- **Announcement:** with VoiceOver running, trigger step 2. The new card's text should be spoken
  **once**, politely (it must not interrupt what VoiceOver is already reading, and it must not be
  announced twice).
- **Nothing colour-only:** squint or use a greyscale filter — each card still states its status
  in words with an icon ("Awaiting change approval", "Failed"), so the tone tint is decoration.
- **Reduced motion:** turn on System Settings → Accessibility → Display → *Reduce motion*.
  A new card should appear **instantly** with no slide-up, and still be fully visible.
- **Region:** the container is labelled "Task notifications" — it should appear as a landmark in
  VoiceOver's rotor even when empty.

---

## Part G — the things that would be easy to get wrong

- **Page load with a gate already pending.** Have a task sitting at a gate, then hard-reload any
  page. **No card should appear** — the page already tells you, and a stack of notices about the
  current state on every navigation would be noise. (Client-side navigation between pages also
  raises nothing new, since the store is not reset.)
- **Cancel at a gate.** With a gate card showing, press Stop on that task. The card should
  **disappear** (the gate is no longer pending) and **no "Cancelled" card** should replace it —
  you did that, so being told about it is pointless.
- **A modal.** Open a diff (`/projects/<id>` → click a changed file) while a card is showing.
  The card must stay **visible above the modal scrim**, not behind it. **Known limitation:** the
  modal's focus trap means you cannot Tab to the card's link while it is open — Escape the modal
  first. This is documented, not a bug to file.
- **Hidden tab.** Switch to another application for 30 seconds while a run finishes, then come
  back. The card should appear on the catch-up poll rather than being lost.
- **Away for a long time.** If you leave for more than a minute, the completion may have aged out
  of the 60-second server window and no card appears. That is by design — the page you return to
  shows the current state, and `ActivityBadge` dropping to zero is the signal.
- **Two browser windows** on the same app. Each has its own store, so each raises its own card.
  Dismissing in one does not dismiss in the other. Expected.

---

## Automated coverage

`docker exec platform env -u RUNNER_HOST pnpm test` — the logic behind all of the above is
unit-tested and does not need a browser:

- `lib/toast.test.ts` — the queue: `key` replacement in place, the cap, the shared empty
  snapshot reference, subscriber notification (and *no* notification on a no-op dismiss).
- `lib/active-tasks.test.ts` — `taskTransitions` for every path above (baseline, gate→gate,
  gate→terminal, cancelled raising nothing, a terminal notice never being withdrawn, a continued
  run finishing twice), plus `sameActiveState` noticing a run that only just finished and
  `parseActiveTasks` validating `finished`.
- `lib/task-toasts.test.ts` — the wiring: one card per run, suppression of the open task's page,
  no replay after navigating away, two watchers installing one subscription, and a remount
  re-baselining instead of replaying.

What tests **cannot** cover here (no DOM tooling in this project): the markup, the live-region
announcement, focus order, the `pointer-events` behaviour, and everything in Parts D and E.
Those are the parts to actually look at.
