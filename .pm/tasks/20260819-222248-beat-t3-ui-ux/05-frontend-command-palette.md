---
title: Command palette (⌘K) — navigate and act from anywhere
stack: frontend
assignee: fe
priority: P2
depends_on: [04-backend-global-search-api.md]
---

# Command palette (⌘K) — navigate and act from anywhere

## Issue
There are no global keyboard shortcuts and no quick way to jump between projects, tasks, and
agents — every move is sidebar + page navigation. T3 Code ships keyboard shortcuts and quick
actions; power users notice their absence here immediately.

## Goal
⌘K / Ctrl+K anywhere opens a palette: type to jump to any project, task, agent, backlog item,
or nav page; plus a few quick actions (new task on a project, open backlog, switch theme).
Fully keyboard-driven and accessible.

## Suggested solution
A bespoke palette built on the existing `Modal` (`components/ui/modal.tsx`) — no cmdk library
(bespoke-components rule). Static entries from `components/nav-links.tsx` and quick actions;
dynamic results from the global search endpoint (`GET /api/search`, task 04) with debounced
as-you-type queries. Keyboard model per the existing roving-focus patterns
(`components/ui/select.tsx`), ARIA combobox/listbox semantics, semantic tokens throughout.
One global keydown listener registered in the `app/(app)/layout.tsx` shell; show the shortcut
hint in the sidebar so it's discoverable. Document in `.fe/design-system.md`.

## Affected areas
- new `components/CommandPalette.tsx` — the palette UI + global shortcut
- `app/(app)/layout.tsx` — mounts it once
- `components/nav-links.tsx` — reused as the static entry source
- `components/Sidebar.tsx` — discoverability hint (⌘K)
- consumes `GET /api/search` (task 04)
- `.fe/design-system.md` — new component entry
