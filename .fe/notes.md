# Frontend Notes & Decisions — index

Reusable frontend lessons not obvious from the code: design decisions and rationale,
framework/build gotchas, and conventions discovered the hard way.

**This file is an index (frontend rule 10).** The notes live in `.fe/notes/`. Read this index,
then open **only** the topics your request touches — or `grep -ril '<term>' .fe/notes/` to find
a note whose topic you don't know. **Never read the whole directory.** Budgets: this index
8 KB, each topic file 30 KB.

`CLAUDE.md` is already in your context — never read it. The token/component reference is
`.fe/design-system.md` (25 KB budget); the component inventory it points at is below.

| Topic | Covers |
|---|---|
| [tokens-and-theming](notes/tokens-and-theming.md) | Tailwind v4 with no config, the semantic token layer, light/dark via `<html>`, and the theming regressions this project keeps having (`fg-ghost`) |
| [primitives](notes/primitives.md) | The shared primitives — **check before hand-rolling** a field, button, modal, select, card or task row |
| [component-catalog-1](notes/component-catalog-1.md) · [component-catalog-2](notes/component-catalog-2.md) | The full reusable-component inventory (frontend rule 3 — check it before building anything new) |
| [pages-and-surfaces-1](notes/pages-and-surfaces-1.md) · [-2](notes/pages-and-surfaces-2.md) · [-3](notes/pages-and-surfaces-3.md) | Per-surface notes: `/tasks`, `/backlog`, feature grouping, the dashboard, usage, the activity badge, toasts, the command palette, the update banner, the diff viewer, syntax highlighting, `loading.tsx` |
| [verification](notes/verification.md) | How to actually look at a page: throwaway DBs, CDP, the headless-Chrome flags this app needs |
| [environment](notes/environment.md) | Build/run traps — the container, `pnpm build` in OrbStack, no native OS dialogs, new route dirs, `apple-icon.png` poison, icons, React lint |

## Writing to this journal
Put a new note in the topic file where it belongs; create a topic (and add its row above) if
none fits. Correct or delete a note that has gone stale — a wrong note is worse than none.
Check `wc -c .fe/notes.md .fe/notes/*.md` before you finish; over budget means consolidate or
split, never append.
