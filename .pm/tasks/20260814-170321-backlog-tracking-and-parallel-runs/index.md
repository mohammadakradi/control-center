# Backlog run-tracking + parallel task runs

**Request (2026-08-14):** three asks — (1) a pm spec dispatched from the task-file modal
leaves its backlog item stuck at `todo`, never reflecting started/in-progress/finished;
(2) the backlog should allow creating items assigned to the pm agent; (3) instead of always
queueing a second task on a busy project, check for overlap and run concurrently when safe.

**Assessment:** (1) BUILD — confirmed: `FileModal.createTask` posts straight to `/api/tasks`,
and only the backlog's own run route links items to tasks. (2) ALREADY-DONE — the Add-item
dialog already offers `/pm` (`AddBacklogItem.tsx`, shipped in b9c2c3b); pm items dispatch
`/pm:plan`. No task. (3) RISKY as requested — overlap isn't knowable pre-run and a shared
checkout collides on the git index/HEAD regardless; the user approved the safer substitute:
opt-in concurrency via per-task git worktree isolation, queueing stays the default.

## Tasks
1. `01-frontend-filemodal-dispatch-via-backlog.md` — **[fe]** Route FileModal "Create task"
   through the backlog run endpoint (resolve item by `sourcePath`, fall back to direct
   dispatch when no item exists).
2. `02-fullstack-parallel-runs-worktree-isolation.md` — **[swe]** Opt-in parallel task runs per
   project via git worktree isolation (runner + dispatch flag + task working-dir plumbing).

Independent — no ordering between them.
