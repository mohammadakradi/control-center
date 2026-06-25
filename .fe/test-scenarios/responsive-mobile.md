# Test scenario — Responsive / mobile compatibility

_Goal: every page is usable on a phone (~375px) with no horizontal overflow, and the nav becomes an app-style bottom tab bar on mobile._

## Setup
1. `pnpm dev` (starts Next.js + runner).
2. Open http://localhost:3000.
3. Open DevTools → device toolbar. Test at **375px (iPhone SE/12 mini)**, **768px (tablet/`sm`)**, and **≥1024px (desktop)**. The app is **dark-only** — confirm dark styling throughout.

## Navigation (the main change)
- [ ] **At 375px:** the top bar shows only the logo + "Control Center". The three links (Dashboard / Agents / Projects) appear as a **fixed bottom tab bar** with icon + label, evenly spaced full-width.
- [ ] Scroll a long page (e.g. a task with a big transcript): the bottom bar stays fixed and never covers page content (there is bottom padding clearance). Page content is fully reachable above it.
- [ ] The active tab is highlighted (white) and matches the current route, including on sub-routes like `/agents/<id>` and `/projects/<id>` (Agents / Projects tab stays lit).
- [ ] On a notched iPhone (or simulated safe-area), the bottom bar respects the home-indicator inset.
- [ ] **At ≥640px (`sm`):** the bottom bar disappears and the links return to the inline top nav. No double nav.
- [ ] Tab targets are comfortably tappable (≥44px).

## Pages — no horizontal overflow at 375px
- [ ] **Dashboard (`/`)**: stat cards stack to 1 column; "Recent activity" rows wrap gracefully (command + project + status) with no sideways scroll; long project names truncate.
- [ ] **Agents list (`/agents`)**: cards go 1-column; long `/namespace` truncates and the "N projects" count stays put.
- [ ] **Agent detail (`/agents/[id]`)**: header chips wrap; "At a glance" tiles fit; "Recent runs" rows wrap without overflow; long source path wraps.
- [ ] **Projects list (`/projects`)**: rows fit; long project name truncates; workspace badge + contributor avatars stay on the right.
- [ ] **Project detail (`/projects/[id]`)**: a long project **name** wraps (no overflow) and the absolute **path truncates** in the header; the Rescan/Remove actions wrap below the title; New-task form controls wrap; the "At a glance" tiles fit; **Source control** — GitControls' remote-sync row keeps Pull/Push usable (the button group wraps to its own line rather than overflowing; tracking / "no upstream" / "no remote" states all fit); single-repo and workspace tabs fit, member paths wrap; "Task history" rows wrap.
- [ ] **Task page (`/tasks/[id]`)**: the `/agent:command` heading wraps instead of overflowing; project path wraps; the live-view toolbar (Show activity / Stop) wraps instead of pushing off-screen; decision bubbles wrap long text inside the pill.

## Regression — desktop unchanged
- [ ] At ≥1024px every page looks the same as before (grids, spacing, inline nav). The added `flex-wrap`/`truncate` classes cause no visible change on wide viewports.

## Accessibility
- [ ] Bottom-bar active item exposes `aria-current="page"`; both navs are labelled `Primary`.
- [ ] Keyboard: Tab reaches the nav links; focus is visible (browser default).

## Automated gate
- [ ] `pnpm lint` — clean.
- [ ] `pnpm build` — succeeds (includes type-check).
