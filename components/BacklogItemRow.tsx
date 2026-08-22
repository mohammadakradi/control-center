"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Check, FileText, Play } from "lucide-react";
import { ExpandableRequest } from "@/components/ExpandableRequest";
import { MergeStateChip } from "@/components/FeatureGroup";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { ErrorAlert, type ErrorAction } from "@/components/ui/error-alert";
import { Chip } from "@/components/ui-cards";
import { Select } from "@/components/ui/select";
import { specBody } from "@/lib/pm-spec";
import {
  ACTIVE_STATUSES,
  BACKLOG_STATUS_LABEL,
  backlogStatusDot,
  dispatchErrorAction,
} from "@/lib/ui";
import type { BacklogItem, TaskMergeState, TaskStatus } from "@/lib/db/schema";

/** What a row needs. Narrower than the database row on purpose — a client component should
 *  not be handed columns it doesn't render. */
export type BacklogRowItem = Pick<
  BacklogItem,
  | "id"
  | "title"
  | "description"
  | "status"
  | "assignee"
  | "priority"
  | "sourcePath"
  | "source"
> & {
  /** Id + status + merge state of the task this item was dispatched as, if any. Never the
   *  transcript: the backlog is shared, and a run belongs to whoever pressed it. */
  linkedTask: {
    id: string;
    status: TaskStatus;
    mergeState: TaskMergeState | null;
  } | null;
};

/** Insertion order of the label map — todo, in_progress, done, cancelled — which is the
 *  order the work moves in, so the menu reads as a progression rather than an alphabet. */
const STATUS_OPTIONS = Object.entries(BACKLOG_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/**
 * One backlog item: what it is, where it came from, what state it's in, and the button that
 * turns it into a real task.
 *
 * Client-side because all three actions mutate and then need the server's view again. The
 * status control renders `item.status` straight from the server rather than holding its own
 * copy — an optimistic local value would have to be reconciled with the sync and the
 * linked-task reflection, both of which can move this row from underneath us, and the
 * project's lint rules rule out the usual (`setState` inside an effect) way of doing that.
 */
export function BacklogItemRow({
  projectId,
  item,
  canOpenLinkedTask,
  parallelOffer = false,
}: {
  projectId: string;
  item: BacklogRowItem;
  /** Whether the viewer owns the linked task. A shared backlog can point at someone else's
   *  run, and `/tasks/<id>` 404s for them by design — so don't offer a link that can't work. */
  canOpenLinkedTask: boolean;
  /** Offer "Isolated": this project can isolate runs at all (a plain git repo, not a
   *  workspace — `parallelOffer` server-side). Where offered the box defaults to *checked*:
   *  isolation is the default and queueing is the manual choice (2026-08-22). On a free
   *  checkout with no feature the flag is harmless — the runner just runs normally. */
  parallelOffer?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"status" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Set when dispatch was refused for a reason the user can act on, so the message can
   *  carry a link instead of being a dead end. */
  const [errorLink, setErrorLink] = useState<ErrorAction | null>(null);
  /** Per-row, because the choice is per-run. Defaults to true — isolation is the default;
   *  unticking is how a run is deliberately queued into the shared checkout instead. */
  const [parallel, setParallel] = useState(true);

  const running = item.linkedTask !== null && ACTIVE_STATUSES.has(item.linkedTask.status);
  // Finished work doesn't offer a Run button — it says so instead. `item.status`, not the
  // linked task's: an item is `done` both when its run finished and when a person marked it
  // done by hand, and those should read identically. Re-running stays one click away via the
  // status control beside it (set it back to To do), which is also the only honest place to
  // put that affordance — a disabled button gets `pointer-events-none`, so a `title`
  // explaining how to re-run would never appear on hover.
  const completed = item.status === "done";
  // The stored description is the spec file verbatim, so the preview has to skip the
  // frontmatter or every synced item opens with `--- title: … stack: …`.
  const body = specBody(item.description).trim();

  async function changeStatus(status: string) {
    if (status === item.status) return;
    // One write at a time. Two overlapping PATCHes would settle in response order rather than
    // click order, and a status change sent *during* a dispatch would race the `in_progress`
    // the run endpoint writes itself — and because this row shows the server's value rather
    // than an optimistic one, either race would resolve silently. Guarding here rather than
    // disabling the control: `Select`'s trigger is the element that has focus at this moment,
    // and disabling a focused button drops the keyboard user back to the top of the page.
    if (busy) return;
    setBusy("status");
    setError(null);
    setErrorLink(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/backlog/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? `Could not save (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the status");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (busy) return; // the button is disabled too; this is the guard that can't be raced
    setBusy("run");
    setError(null);
    setErrorLink(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/backlog/${item.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `parallelOffer` is re-checked here, not just used to render the checkbox: the flag is
        // refused outright for a non-git project or a workspace, so sending it where it was
        // never offered would turn a stale click into an error instead of a normal run.
        //
        // Accepted trade, raised by review: if the offer goes *false* between the tick and the
        // click (a `router.refresh()` after the other run finished), a ticked box is dropped and
        // the run merely queues, with no error and no notice. It fails safe, the box visibly
        // disappears in the same repaint, and it matches `NewTaskForm`'s existing gate — the
        // alternative (sending it regardless) trades a silently normal run for a hard 400 on the
        // one case that genuinely can't isolate.
        body: JSON.stringify({ parallel: parallel && parallelOffer }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.task?.id) {
        router.push(`/tasks/${payload.task.id}`);
        return; // keep the spinner up through the navigation
      }
      setError(payload.error ?? `Could not start the task (${res.status})`);
      setErrorLink(dispatchErrorAction(payload));
      setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the task");
      setBusy(null);
    }
  }

  return (
    <li className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {/* Decorative: the same status is written out in the control opposite. */}
          <span
            aria-hidden="true"
            className={`mt-1.5 size-2 shrink-0 rounded-full ${backlogStatusDot(item.status)}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-words text-fg-strong">{item.title}</p>

            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
              {item.priority && <Chip>{item.priority}</Chip>}
              {item.assignee && (
                <span className="font-mono text-fg-faint">/{item.assignee}</span>
              )}
              {item.source === "agent" && (
                <Chip
                  tone="warn"
                  icon={<Bot className="size-3" aria-hidden="true" />}
                  title="An agent filed this during another task. Nobody has reviewed the text — read it before running it."
                >
                  agent-filed
                </Chip>
              )}
              {item.sourcePath && (
                <span
                  title={item.sourcePath}
                  className="inline-flex min-w-0 items-center gap-1 font-mono text-fg-faint"
                >
                  <FileText className="size-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.sourcePath}</span>
                </span>
              )}
              {item.linkedTask && (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="text-fg-faint">Last run</span>
                  <StatusBadge status={item.linkedTask.status} />
                  {/* Where that run's branch stands. Beside the run's own status rather than
                      replacing it, because the two are independent: a task can be `done` with
                      `mergeState: "conflict"` — the agent finished, the merge didn't. The chip
                      decides for itself whether it has anything to say (`mergeChipView`). */}
                  <MergeStateChip task={item.linkedTask} />
                  {canOpenLinkedTask && (
                    <Link
                      href={`/tasks/${item.linkedTask.id}`}
                      className="text-accent hover:text-accent-hover"
                    >
                      Open task
                    </Link>
                  )}
                </span>
              )}
            </div>

            {body && (
              <div className="text-xs leading-relaxed">
                <ExpandableRequest text={body} />
              </div>
            )}
          </div>
        </div>

        <div
          aria-busy={busy !== null || undefined}
          className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto"
        >
          <Select
            value={item.status}
            onChange={changeStatus}
            options={STATUS_OPTIONS}
            ariaLabel={`Status — ${item.title}`}
            className="min-w-36 flex-1 sm:flex-none"
          />
          {/* Only where the run can actually take it (a plain git repo, not a workspace), and
              only next to a Run button that isn't already spent. Checked by default —
              isolation is the default; unticking queues the run into the shared checkout. Not
              disabled while a dispatch is in flight — the value was read when Run was pressed,
              and disabling a focused control drops the keyboard user out of this row. */}
          {parallelOffer && !completed && !running && (
            <label
              className="inline-flex items-center gap-1.5 text-xs text-fg-subtle"
              title="Runs in its own copy of the project (a git worktree) on its own branch, so it can't collide with other runs — and a feature task is merged back automatically when it finishes. Untick to queue this run into the shared project checkout instead."
            >
              <input
                type="checkbox"
                checked={parallel}
                onChange={(e) => setParallel(e.target.checked)}
                // A page holds many of these, so the accessible name has to say which item
                // it belongs to — "Isolated" alone repeats down the whole list.
                aria-label={`Run isolated (in parallel) — ${item.title}`}
              />
              Isolated
            </label>
          )}
          {/* `md`, not `sm`: `Select`'s trigger is a `py-2 text-sm` control with no size
              prop, and a small button beside it sits visibly short of its height. */}
          <Button
            variant={completed ? "success" : "accent"}
            onClick={run}
            loading={busy === "run"}
            disabled={completed || running || busy !== null}
            icon={
              completed ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )
            }
            title={
              completed
                ? "This item is done — set its status back to To do to run it again"
                : running
                  ? "This item is already running as a task"
                  : item.assignee === "pm"
                    ? "Hand this to the pm agent to investigate and break into tasks"
                    : item.assignee
                      ? `Dispatch this item to the ${item.assignee} agent`
                      : "Dispatch this item as a task"
            }
          >
            {busy === "run"
              ? "Starting…"
              : completed
                ? "Done"
                : running
                  ? "Running"
                  : item.linkedTask
                    ? "Re-run"
                    : "Run"}
          </Button>
        </div>
      </div>

      <ErrorAlert message={error} action={errorLink} className="mt-2 text-xs" />
    </li>
  );
}
