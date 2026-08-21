---
title: Parallel option on backlog and pm-spec dispatch paths
stack: fullstack
assignee: swe
priority: P2
depends_on: []
---

# Parallel option on backlog and pm-spec dispatch paths

## Issue
Only the manual composer can start a parallel run: `NewTaskForm` sends `parallel=1` to
`POST /api/tasks`, but `POST /api/projects/[id]/backlog/[itemId]/run` reads no request body
at all and dispatches with `parallel` unset, and neither `BacklogItemRow`'s Run button nor
`FileModal`'s "Create task" offers the option. So a backlog item or pm-planned spec always
queues behind a busy checkout, even though `DispatchInput.parallel` (`lib/dispatch.ts`) and
the whole worktree machinery already exist.

## Goal
Running a backlog item or a pm spec can opt into parallel isolation exactly like a manual
dispatch — same offer conditions, same refusals — so a batch of planned tasks can be fanned
out concurrently.

## Suggested solution
- The run route accepts an optional JSON body `{ parallel?: boolean }` and passes it through
  to `createAndStartTask`, inheriting the existing refusals (non-git project, workspace).
- Surface the "Run in parallel" choice on `BacklogItemRow`'s Run button and in
  `FileModal.createTask`, under the same conditions `NewTaskForm` uses (`parallelOffer`:
  checkout busy + plain git project + not a workspace — computed today in
  `app/(app)/projects/[id]/page.tsx` from `checkoutBusy`; the backlog and file-modal hosts
  need the same signal where they render).
- `FileModal`'s `dispatchDirect()` fallback (specs the backlog can't hold) passes `parallel`
  to `POST /api/tasks` the same way.
- Note: once task 02 lands, feature-linked parallel runs always isolate regardless of
  busyness — this task doesn't depend on that, it just plumbs the flag end to end.

## Affected areas
- `app/api/projects/[id]/backlog/[itemId]/run/route.ts` — accept `{ parallel }`
- `components/BacklogItemRow.tsx` — Run button gains the parallel choice
- `components/FileModal.tsx` — `createTask`/`runBacklogItem`/`dispatchDirect` carry it
- `app/(app)/projects/[id]/page.tsx` and the backlog/file-modal hosts — `parallelOffer`
  (`checkoutBusy`) plumbing, matching `components/NewTaskForm.tsx`'s existing pattern
