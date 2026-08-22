# Feature grouping, feature branches, and parallel runs from the backlog

**Request (2026-08-21):** Work in a project is organized around *features*, each spanning
several tasks. (1) Group a feature's tasks and backlog items together — in the backlog, the
project detail page, and the Tasks menu — so each feature can be followed independently.
(2) Give each feature a single feature branch; when its tasks run (especially in parallel),
merge their work into that branch, so "all tasks done" means "all changes are on the feature
branch". (3) Parallel runs are currently only available from the manual new-task composer —
running a backlog item or a pm-planned spec should support parallel too.

## Request assessment
- **Verdict:** BUILD (all three parts), with the merge-back part flagged as the risky piece
  and designed around (deterministic runner-side merge; conflicts surface, never auto-resolved).
- **What was asked:** feature-level grouping across three UI surfaces; one branch per feature
  with automatic merge-back of task work; parallel dispatch from backlog/pm-spec runs.
- **What the code actually does:**
  - No feature/group concept exists. `tasks` has no group column (`lib/db/schema.ts`);
    `backlog_items` only embeds the pm request folder inside `sourcePath`
    (`.pm/tasks/<request>/<task>.md`, built in `scanPmSpecs`, `lib/backlog.ts`) and nothing
    parses it out. The Tasks page groups by project only (`app/(app)/tasks/page.tsx`), the
    Backlog pages group Open vs Done only, project detail history is flat, and the shared
    `components/TaskList.tsx` has no grouping prop.
  - Worktree runs create `task/<id>` off the checkout's *current HEAD* with no base-ref
    option (`ensureTaskWorktree`, `runner/worktree.ts`); **no merge machinery exists
    anywhere** — `finalize()` (`runner/session-manager.ts`) only records the branch and
    removes a clean worktree. Merging was deliberately left to the PR/ship flow (2026-08-14
    decision — this request reverses that, knowingly).
  - `DispatchInput.parallel` exists (`lib/dispatch.ts`) and only `NewTaskForm` →
    `POST /api/tasks` carries it. `POST /api/projects/[id]/backlog/[itemId]/run` reads no
    request body at all; `FileModal.createTask` and `BacklogItemRow.run()` send no options.
- **Already implemented?** No part of it. Closest partial: the pm request folder is an
  implicit group key for pm-planned backlog items, stored but never surfaced.
- **Risks / conflicts:** merges can conflict (parallel siblings editing the same files) —
  must surface as per-task "unmerged" state, never auto-resolve, never fail silently; a merge
  must never touch the user's checkout HEAD (temp worktree + hardened `lib/git.ts` path:
  NO_HOOKS, pinned config, timeouts — it runs in the runner process against a repo agents can
  write hooks/config into); `launchMode` isolates only when the checkout is busy, so the first
  of N parallel feature tasks would land in the shared checkout — feature-linked parallel runs
  must always isolate; `MAX_WORKTREES = 16` bounds concurrent isolation; checkout (non-parallel)
  runs are agent-owned git, so their feature-branch guarantee is instruction-level (preamble).
- **Real need:** follow a feature as one unit — see its tasks together, fan them out
  concurrently, and end with one branch holding all the merged work.
- **Recommendation:** proceed — approved at the proposal gate 2026-08-21.

## Approved solution (in brief)
- New `features` table (id, projectId, name, branch, status) + nullable `featureId` on
  `tasks` and `backlog_items`, via versioned migration. Features arise two ways, mirroring
  backlog items: the sync auto-creates one per `.pm/tasks/<request>/` folder, and the UI can
  create/assign them by hand.
- Runner: first feature-linked run creates `feature/<slug>` off the project's default branch;
  feature-linked parallel runs always isolate, basing `task/<id>` on the feature branch; on
  `done`, the runner merges the task branch into the feature branch in a temporary worktree.
  Conflict → task marked unmerged, branch left intact, state shown in the UI.
- Backlog run route accepts `{ parallel }`; the backlog Run button and FileModal offer it
  under the same conditions as `NewTaskForm`.
- All three surfaces (per-project backlog + global Backlog, project detail, Tasks menu)
  group by feature, with branch + merge-state chips and an ungrouped section.

## Tasks
1. `01-backend-feature-entity-schema-sync-api.md` — **[swe]** Feature entity: schema, backlog
   sync, and API (P1, no deps)
2. `02-services-feature-branch-merge-runner.md` — **[swe]** Feature branch lifecycle +
   merge-back in the runner (P1, depends on 01)
3. `03-fullstack-parallel-backlog-spec-dispatch.md` — **[swe]** Parallel option on backlog and
   pm-spec dispatch paths (P2, independent)
4. `04-frontend-feature-grouping-ui.md` — **[fe]** Feature grouping across Backlog, project
   detail, and Tasks (P2, depends on 01 + 02)
