# Test scenario — Hide closed features by default, with a filter to bring them back

_Manual verification for the `?features=` filter on the project page's **Features** card and on
`/backlog`. Closed means `done` **or** `cancelled`; this is a visibility change only — no
feature's status, branch or work is touched anywhere in it._

## Setup
You need one project with **both** kinds of feature. In the app:

1. Open a project with a few features (or add three via **Features → Add feature**).
2. Close one or two out with **Close out**, so the project has at least one active and at least
   one closed feature. If you want the `cancelled` tone too, close one out and cancel another.
3. File a backlog item under an active feature and one under a closed feature
   (**Backlog → Add item** files under active features only, so for the closed one: file it
   first, *then* close the feature out).

Three shapes are worth having if you can arrange them, because each hits a different branch:
a project with **some** closed features, one with **every** feature closed, and one with
**none** closed.

## 1 · The Features card shows active work only
1. Open the project page and look at the **Features** card.
   - **Expected:** only active features are listed. The closed ones are gone from the list but
     **not** from the page — the header now carries two pills, **Active N** and **Closed N**,
     with Active selected.
   - **Expected:** the header's right side reads the task count only ("N tasks"); the feature
     count moved into the pills, so nothing is said twice.
2. Click **Closed**.
   - **Expected:** the URL becomes `/projects/<id>?features=closed`, the list swaps to the
     closed features — each with its **Done** or **Cancelled** chip and a **Reopen** action —
     and the **Add feature** button disappears. (You can't add a feature *into* the closed
     view; go back to Active to add one.)
3. Click **Active** again.
   - **Expected:** a clean `/projects/<id>` with **no** query param. The default view and the
     bare URL are the same address.
4. Press **Back** a few times, then copy `/projects/<id>?features=closed` into a new tab.
   - **Expected:** each view is a real history entry, and the link opens straight into the
     closed view. The filter is bookmarkable and shareable — it is links, not client state.

## 2 · Nothing vanishes silently
1. From the closed view, press **Reopen** on a feature.
   - **Expected:** it leaves the closed list immediately and is in the Active list when you
     switch back. **Closed N** drops by one.
2. Reopen the project's **last** closed feature while you are still in the closed view.
   - **Expected:** the pills **stay on screen** (Closed 0) and the card says "Nothing has been
     closed out in this project — every feature is still active." This is the case that would
     otherwise strand you: with the control hidden, the only way out is the Back button.
3. On a project where **every** feature is closed, load the default view.
   - **Expected:** "Every feature here has been closed out. Pick “Closed” above to see them, or
     add a new one." — never a bare "No features yet", which would read as data loss.
4. On a project that has **never** closed a feature out, load the page.
   - **Expected:** **no pills at all**, and the header reads "N features · M tasks" exactly as
     it always did. With nothing closed there is no choice to make, so the control doesn't
     appear. This is the regression guard: most installs should see no change whatsoever.

## 3 · The card's tasks stay where they belong (regression guard)
1. Find a project where a closed feature has task runs under it.
2. Load the default (Active) view and scroll the card and the task list below it.
   - **Expected:** the closed feature's runs do **not** reappear in a "No feature" bucket. They
     are filed under their feature, which you reach via **Closed**. A run must never look
     ungrouped just because its feature is out of view.
3. View source (⌥⌘U) on the default view and search for that run's title.
   - **Expected:** **no hits.** The card is a client component, so anything handed to it is sent
     to the browser whether or not it is drawn — a run you are not looking at shouldn't be in
     the page at all. Switch to **Closed** and the same search finds it.

## 4 · `/backlog` — same filter, same URL
1. Open **Backlog** and pick the project.
   - **Expected:** under the row of project pills there is a second row reading
     **Features  Active N  Closed N**. The word "Features" is there because the pills sit on a
     page that also counts open/closed *items* — without it, "Closed 5" reads as items.
2. Look at the **Open** and **Done & cancelled** sections.
   - **Expected:** items belonging to closed features are not listed, but the section's own
     count still says how many items the section really has, and a line at the bottom of the
     section discloses the rest with a link: "1 item in closed features — show the closed ones".
3. Click that link.
   - **Expected:** you land in `?features=closed` **with the project still selected** — the
     link carries `?project=` along. The disclosure flips to "N items in active features —
     show the active ones".
4. Switch the project with the pills above while `?features=closed` is set.
   - **Expected:** you land on the new project's **Active** view — the project pills carry no
     other params, exactly as they already reset a lifted `?all=1` row cap. A different
     project's features are a different set, so the view resets with them. What must *not*
     happen is landing on a page that lists nothing and explains nothing.
5. Find a section whose items are **all** in closed features.
   - **Expected:** instead of an empty section you get the sentence "N items here are in closed
     features — show the closed ones", with the link.

## 5 · The row cap and the filter agree
1. Find (or make) a project with more than 5 open items, enough that a section shows
   **Show all N**.
   - **Expected:** the cap applies to what you can *see*. A closed feature holding fifty items
     can no longer eat the row budget and push live work behind the disclosure.
2. Click **Show all** while in the closed view.
   - **Expected:** the URL keeps **both** `?all=1` and `?features=closed`. Lifting the cap must
     not silently throw you back to the active view.

## 6 · The Add-item picker is unchanged (regression guard)
1. In either view, press **Add item** on `/backlog` and open the feature dropdown.
   - **Expected:** "No feature" plus the project's **active** features — exactly as before,
     and *the same list in both views*. The picker files new work, so it never offers a closed
     feature (that would quietly reopen something every list shows as finished), and a form's
     contents must not change with the page's view setting.

## 7 · A filtered-in closed feature still starts folded
1. In `/backlog`'s closed view, look at a closed feature's group heading.
   - **Expected:** it starts **collapsed**, with its item count on the heading; clicking the
     heading expands it. That is the pre-existing behaviour and it is still right — you asked
     to see the closed ones, so the headings are the answer and the rows are the detail.

## 8 · Responsive (resize to ~390px, or use device emulation)
- **Expected:** the Features card header wraps to three lines — heading, then the pills beside
  the task count, then **Add feature** — and stays right-aligned. No horizontal page scroll.
- **Expected:** on `/backlog` the two pill rows stack, with "Features" leading the second one.
  No horizontal page scroll in either view.
- **Expected:** a long feature name still wraps rather than pushing the row wide (the pills
  themselves truncate their label at `max-w-full`).

## 9 · Dark mode
Toggle **Light → Dark → System** in the sidebar footer on both surfaces, in both views.
- **Expected:** the selected pill stays legible in both themes — it is a raised `surface-3`
  chip with a stronger border, and the unselected ones are `surface-2`. The counts inside the
  pills stay readable (they are `fg-faint`, deliberately not the sub-AA `fg-ghost`).
- **Expected:** nothing flashes light on reload, and no element keeps a light-only colour.

## 10 · Accessibility
- **Keyboard:** Tab to the pills — each is a link, takes focus in order with the global focus
  outline, and Enter activates. On `/backlog` the visible "Features" word is not a tab stop.
- **Screen reader:** the row is a navigation landmark named **"Filter features by status"**;
  the selected pill is announced as current. The bare number in a pill is hidden and read as
  words instead — "Closed, 5 closed features", never "Closed 5". The visible "Features" label
  is hidden from assistive tech, because the landmark's name already says it and better.
- **Not colour-alone:** the selected pill differs by border strength and surface, not hue
  alone, and `aria-current` carries the state independently of any of it.
- **JS off:** the whole feature still works. Both pages are server components and the filter is
  plain links.

## 11 · Bad input (shouldn't be reachable, but)
1. Visit `/projects/<id>?features=bogus`, then `?features=closed&features=active`, then
   `?features=DONE`, then `?features=`.
   - **Expected:** every one of them renders the normal **Active** view — no error page. Only
     the exact string `closed` selects the closed view, the same leniency rule `/usage?range=`
     follows.
2. Do the same on `/backlog?project=<id>&features=bogus`.
   - **Expected:** identical behaviour. One bookmark means the same thing on both pages.
