# Test scenario — Instant-feel navigation (route skeletons + prefetch)

What changed: every `app/(app)/**` route gained a `loading.tsx` skeleton. Because all of these
pages are `force-dynamic`, that also switches on `<Link>` prefetch, which previously did nothing.

> **You must test a production build.** "Automatic prefetching runs only in production" (Next's
> own prefetching guide), so on `pnpm dev` you will see the skeletons but *not* the prefetch win —
> every skeleton will linger for the full server render instead of appearing instantly. Testing
> this on the dev server and concluding "it's slow" is the one wrong turn available here.

## Setup

```bash
pnpm build                                   # inside the container; pins NODE_ENV=production
# then serve the build on a throwaway DB so you don't touch data/platform.db
docker exec -d platform sh -c 'cd /app && PLATFORM_DB=/tmp/scratch.db \
  npx next start -H 0.0.0.0 -p 3099 > /tmp/scratch.log 2>&1'
```

Seed a few projects and tasks into `/tmp/scratch.db` (`user_id = 'user_local'` — no session
needed, `getCurrentUser()` returns the local workspace). Reach it from the host at the
container's IP on `:3099` (`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' platform`),
or use the real app on `:3001` if you'd rather click around your actual data.

**Cleanup when done:** the `next start` process renames itself to `next-server (v16.2.9)`, so
find it by walking `/proc/*/cmdline` and take the **high** PID — the low one is the container's
own dev server, which you must not kill.

## 1. The headline: Projects → project no longer freezes

1. Open `/projects`. Wait ~3s on the page (let the prefetch queue drain).
2. Click a project.
3. **Expect:** the skeleton appears *immediately* — page header bar, a tall "New task" card, a
   two-tile "At a glance" block, and a task-history list. Measured at **17 ms**.
4. **Before this change this took 2696 ms**, during which the *Projects list* stayed on screen
   with no indication anything had happened. If you see the old page persist for over a second,
   something has regressed.
5. **Expect the app chrome to stay live underneath:** the sidebar is still interactive, the
   "Projects" nav entry stays lit, and the "N in progress" activity pill keeps updating. That's
   the shared layout not re-rendering — if the sidebar blanks too, a `loading.tsx` has been put
   at the wrong level.

Repeat for `/backlog` (was 720 ms), `/tasks` (238 ms) and `/usage` (55 ms) from the sidebar.

## 2. Shape fidelity — the skeleton must not jump

For **each** of the ten routes, watch the moment the real content replaces the skeleton.

| Route | Skeleton should show |
|---|---|
| `/` | header, 4 stat tiles, 2 side-by-side card lists, a wide activity list |
| `/projects` | header, a thin add-project bar, 4 project rows |
| `/projects/[id]` | back link, title + 3 chips + 2 action buttons, full-width New task card, At-a-glance (2 tiles + 3 facts), Source control, full-width task history |
| `/tasks` | header, a filter chip row, 3 card groups of rows |
| `/tasks/[id]` | back link, 56px avatar + title + 4 chips, a Changes card, a `bg-sunken` transcript block |
| `/agents` | header, 2 agent cards each with avatar + 6 skill pills |
| `/agents/[id]` | back link, 80px avatar + title, At-a-glance (4 tiles + 2 facts), Connected projects, full-width Skills grid, full-width Recent runs |
| `/backlog` | header **with an action button**, filter chips, 6 backlog rows |
| `/usage` | header **with an action button**, a 3-figure card, a 4-row card |
| `/settings` | header, 2 form cards |

**Pass:** blocks land in roughly the same places; the page doesn't visibly lurch.
**Fail:** content shifts by more than a card's padding, or a skeleton block has no counterpart
in the real page (or vice versa).

Two deliberate absences — these are correct, not bugs:
- `/projects/[id]` has **no** skeleton for `TokenNudge` (it renders nothing once a token is saved).
- `/usage` shows **two** cards, not three — `PlanLimits` renders nothing on this app.

## 3. Responsive

At **390px**, **768px** and **1280px**, hold a skeleton on screen (see §6) and check:
- No horizontal scrolling. Verified programmatically as `scrollWidth - clientWidth === 0` at
  390px and 1280px. This is the failure mode the design system's `grid-cols-1` rule exists for.
- At 390px the two-column grids on `/projects/[id]` and `/agents/[id]` collapse to one column.
- At 390px the detail header's action buttons wrap **below** the title/chips rather than
  squeezing them.
- The mobile top bar and bottom tab bar stay visible and usable while the skeleton is up.

## 4. Dark mode

Check every skeleton in both themes (sidebar footer toggle, or emulate `prefers-color-scheme`).
- Light: bars are `#e7e7ea`. Dark: bars are `#232327`. Both are `bg-surface-3`.
- Bars must be clearly visible against the `bg-surface` card they sit on but must not read as
  content. If they vanish into the card in light mode, someone has changed the surface token.
- No `dark:` variants were added; if the two themes disagree in any way other than those two
  colours, that's a bug.

## 5. Accessibility

1. **Screen reader.** Navigate to a slow route with VoiceOver on. Expect **one** announcement:
   "Loading project…" (or projects / tasks / task / agents / agent / backlog / usage / settings /
   dashboard). You must **not** hear a stream of anonymous items — the bars are `aria-hidden`.
2. **Nothing focusable in the skeleton.** Tab while a skeleton is displayed: focus should move
   through the sidebar and app chrome only, never into the placeholder bars.
3. **Reduced motion.** Turn on System Settings → Accessibility → Display → Reduce Motion (or
   emulate `prefers-reduced-motion: reduce`) and hold a skeleton.
   - **Expect:** bars are completely static and **fully visible**.
   - **Not** acceptable: still pulsing, or frozen at a half-faded opacity.
   - Verified programmatically: `animation-duration: 1e-05s`, `iteration-count: 1`,
     `opacity: 1`. The opacity is the part that matters — it comes from the keyframe declaring
     only its `50%` stop, so it settles back at the element's own value.
4. **Contrast.** The bars are decoration, not text, so they carry no contrast requirement — but
   the `sr-only` label must remain in the accessible tree (don't "fix" it to `display: none`).

## 6. Holding a skeleton still long enough to inspect it

The skeletons are designed to be brief, so catching one needs help. No source change required:

1. Load `/projects` and wait ~3s so the destination shell is prefetched.
2. In DevTools → Network, set throttling to a high-latency profile (or via CDP,
   `Network.emulateNetworkConditions` with `latency: 3000`).
3. Click a project.

The skeleton renders instantly from the prefetch cache while the real render stalls behind the
latency — so it sits on screen for as long as you need. This is how the light/dark and 390px
passes were done.

## 7. Prefetch sanity (regression guard)

The reason `loading.tsx` matters here is that it changes what a prefetch returns. Confirm:

```bash
# route tree only (~254 B) would mean the loading boundary is gone
curl -s -o /tmp/p.bin -w '%{size_download}b %{time_total}s\n' \
  -H 'RSC: 1' -H 'Next-Router-Prefetch: 1' http://<ip>:3099/projects/<id>
grep -c animate-skeleton /tmp/p.bin     # expect > 0
```

**Expect** ~20 KB containing `animate-skeleton`. If it drops back to ~254 bytes with no
skeleton markup, that route's `loading.tsx` has been deleted or moved and its navigation is
back to freezing the previous page.

Also confirm a prefetch stays cheap: on `/tasks` (≈45 in-viewport links) the whole prefetch
burst is ~61 requests / **6.2 KB** compressed. If that grows a lot, re-check before reaching for
`prefetch={false}`.

**And confirm a prefetch still doesn't execute the page** — this is the guard that matters, since
`/projects/[id]` shells out to git and `/backlog` scans the filesystem, in the same process that
serves the SSE streams. Test it by side effect, not by timing, because both those pages *write*
when they render:

1. In the throwaway DB: `UPDATE projects SET default_branch='SENTINEL', is_git=0 WHERE id=…`
   and `DELETE FROM backlog_items`.
2. Fire ~25 prefetch-shaped requests at `/projects/<id>` and `/backlog?project=<id>`
   (`-H 'RSC: 1' -H 'Next-Router-Prefetch: 1'`).
3. **Expect the sentinel intact and `backlog_items` still 0.**
4. Positive control — one request with `RSC: 1` and **no** prefetch header. `default_branch`
   should now hold the real branch and `backlog_items` should be populated. If step 4 doesn't
   change anything, your detector is broken and step 3 proved nothing.

## 8. What is deliberately NOT here

- **No view transitions.** They were verified to work in this build (`experimental.viewTransition`
  validates and builds) and deliberately deferred — see `.fe/notes.md`. So the skeleton→content
  swap is a plain instant swap, not a crossfade. That is expected, not an unfinished edge.
- **No optimistic UI.** `BacklogItemRow` still renders server state, on purpose.
