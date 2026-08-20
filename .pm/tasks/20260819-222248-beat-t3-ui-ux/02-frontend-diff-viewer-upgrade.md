---
title: Diff & file viewer upgrade — syntax highlighting, split view, file navigation
stack: frontend
assignee: fe
priority: P2
depends_on: []
---

# Diff & file viewer upgrade — syntax highlighting, split view, file navigation

## Issue
`DiffModal` renders raw unified diff text in a plain `<pre>`, colored only by `+`/`−` prefix;
`FileModal` shows non-markdown files as unstyled monospace. No syntax highlighter exists in
the app. T3 Code offers unified *and* split views; ours is behind on the core review surface.

## Goal
Diffs and code files read like a code review tool: language-aware syntax highlighting themed
through the existing token layer, a unified ↔ split (side-by-side) toggle, and prev/next-file
navigation inside the diff modal so reviewing many files doesn't mean open-close-open.

## Suggested solution
Add one lightweight highlighter (evaluate Shiki vs. highlight.js for bundle/SSR fit under
this non-standard Next 16.2.9 — read `node_modules/next/dist/docs/` first) and map its theme
to the semantic CSS variables in `app/globals.css` — never `dark:` variants. Parse the
existing unified diff text client-side into rows to support the split view; keep the current
prefix-coloring as fallback for unparseable/binary hunks (note `untrackedDiff` in `lib/git.ts`
synthesizes git-shaped diffs — don't assume every diff came from git). Feed prev/next
navigation from the same file list `ChangesList` already holds. Update `.fe/design-system.md`.

## Affected areas
- `components/DiffModal.tsx` — split/unified toggle, highlighting, prev/next file controls
- `components/FileModal.tsx` — highlighting for code files
- `components/ChangesList.tsx` — passes the file list for in-modal navigation
- `app/globals.css` — highlighter theme tokens (light + dark)
- `.fe/design-system.md` — document the new viewer patterns
