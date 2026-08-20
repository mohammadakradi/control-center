# Beat T3 Code on UI/UX

**Request:** investigate https://t3.codes/ (T3 Code — open-source control plane for coding
agents, same product category) and improve this project's UI/UX to be better than it.

**Assessment (BUILD):** T3's praised traits are a three-panel instant-switching workspace,
turn-by-turn diff review (unified + split), live chat transcripts, keyboard shortcuts, and
one-click PR. We already beat it on approval-gated workflows, planning/backlog loop, security,
token vault, usage tracking, theming, and PWA/Mac app. Confirmed gaps in our UI: no per-task
diff anywhere, unified-only unhighlighted diffs, no toasts/notifications, no command palette,
no task search, spinner-only full-page navigations. Deliberately rejected: in-app terminal
(security), commit/PR buttons (git-through-agents is our design stance), full SPA rewrite
(incremental perceived-speed work instead), kanban backlog.

## Tasks
1. `01-fullstack-task-changes-panel.md` — **[swe]** Per-task changes & diff review on the task page (P1)
2. `02-frontend-diff-viewer-upgrade.md` — **[fe]** Syntax highlighting, split view, file navigation in the diff/file viewers (P2)
3. `03-frontend-toast-attention-system.md` — **[fe]** Global toasts for gate-waiting / finished / failed tasks (P1)
4. `04-backend-global-search-api.md` — **[swe]** Global search API: tasks, projects, agents, backlog (P2)
5. `05-frontend-command-palette.md` — **[fe]** ⌘K command palette: navigate + quick actions (P2, depends on 4)
6. `06-frontend-instant-feel-navigation.md` — **[fe]** Loading skeletons, prefetch, view transitions (P2)
