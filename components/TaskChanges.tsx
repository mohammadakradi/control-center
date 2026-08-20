"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { taskChangesView, type TaskChangesResponse } from "@/lib/ui";
import { CardSection } from "./ui-cards";
import { ChangesList } from "./ChangesList";
import { Button } from "./ui/button";

/**
 * What this run changed on disk — the counterpart to the transcript above it.
 *
 * Where the changes come from depends on how the task ran, and the difference is stated on
 * screen rather than smoothed over: an isolated (parallel) run has its own git worktree, so the
 * list is exactly its own work; a run in the project checkout shares that tree with everything
 * else, so the same list can hold edits this task never made.
 *
 * **Not polled.** Each load costs two git subprocesses in the process that also serves the SSE
 * task streams, so a live task refreshes on its own only when it ends — `status` changes, which
 * `TaskLiveView`'s `router.refresh()` propagates from the server — plus whenever the user asks.
 *
 * The render decisions live in `taskChangesView` (`lib/ui.ts`) rather than here, because
 * `pnpm test` cannot reach `components/` and a review rightly called this the branchiest new
 * code with the least verification. This component is the wiring; the decisions have specs.
 */
export function TaskChanges({
  taskId,
  projectId,
  status,
  className = "",
}: {
  taskId: string;
  projectId: string;
  /** Re-fetches when this changes, which is how a finishing run updates its own list. */
  status: string;
  /** Spacing is the page's business — this card sits between two unrelated blocks. */
  className?: string;
}) {
  const [data, setData] = useState<TaskChangesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // null = follow the default for this scope; a boolean means the user has decided.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const regionId = useId();
  /**
   * Which request is the current one. Two loads can overlap — the run ends (a `status` change)
   * while a manual refresh is still in flight — and without this the older response could resolve
   * last and silently overwrite the newer list with stale counts. A review found that; a counter
   * is enough, and it is a ref rather than state so the effect can bump it without re-rendering.
   */
  const seq = useRef(0);

  // Sets no state synchronously, so the effect below can call it: `react-hooks/set-state-in-effect`
  // rejects a synchronous setState in an effect body, and `loading` starts true for the first
  // load anyway. The manual refresh turns the spinner on itself, from an event handler.
  const load = useCallback(() => {
    const mine = ++seq.current;
    return fetch(`/api/tasks/${taskId}/changes`)
      .then((r) => r.json())
      .then((d: TaskChangesResponse) => {
        if (mine !== seq.current) return; // superseded — drop it
        if (d?.error) setErr(d.error);
        else {
          setData(d);
          setErr(null);
        }
      })
      .catch((e) => {
        if (mine === seq.current) setErr((e as Error).message);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [taskId]);

  useEffect(() => {
    void load();
    // `status` is not used in the body — it is the signal to re-read a finished run's tree.
  }, [load, status]);

  const refresh = () => {
    setLoading(true);
    void load();
  };

  const view = taskChangesView(data);
  // No card at all for a non-git project, a workspace, a task that isn't visible, or the first
  // load: a section the user didn't ask for shouldn't flash and then explain itself. An error is
  // only worth showing once there is something it interrupted — see the banner below.
  if (view.kind === "hidden" && !(err && data)) return null;

  const list = view.kind === "list" ? view : null;
  // Expanded by default only when the tree is exclusively this task's. The checkout's
  // uncommitted state is shared, so on a historical task it is usually noise.
  const open = manualOpen ?? (list?.exclusive ?? false);

  return (
    <CardSection
      title="Changes"
      className={className}
      right={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            loading={loading}
            onClick={refresh}
            aria-label="Refresh changes"
            title="Refresh changes"
            icon={<RefreshCw className="size-3.5" aria-hidden="true" />}
          />
          {list && (
            <button
              type="button"
              onClick={() => setManualOpen(!open)}
              aria-expanded={open}
              aria-controls={regionId}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-accent hover:text-accent-hover"
            >
              {open ? (
                <>
                  <ChevronUp className="size-3.5" aria-hidden="true" /> Hide
                </>
              ) : (
                <>
                  <ChevronDown className="size-3.5" aria-hidden="true" /> Show
                </>
              )}
            </button>
          )}
        </div>
      }
    >
      {/* A failed *refresh* keeps the last-known-good list underneath instead of replacing it
          with an error — the previous list is still the truth as of when it was read, and
          throwing it away for a transient fetch failure loses more than it tells (review). */}
      {err && (
        <p role="alert" className="mb-2 text-sm text-danger">
          Couldn&apos;t load this task&apos;s changes: {err}
        </p>
      )}

      {view.kind === "removed" ? (
        <p className="text-sm text-fg-faint">
          This run&apos;s isolated worktree was cleaned up after it finished, so there
          is no working tree left to compare.
          {view.branch ? (
            <>
              {" "}
              Its committed work is on{" "}
              <span className="font-mono text-fg-subtle">{view.branch}</span>.
            </>
          ) : null}
        </p>
      ) : view.kind === "empty" ? (
        <p className="text-sm text-fg-faint">
          {view.scope === "worktree"
            ? "This run's worktree has no uncommitted changes."
            : "Working tree clean."}
        </p>
      ) : list ? (
        <div id={regionId}>
          {!list.exclusive && (
            /* Says whose changes these are, because a list headed "Changes" on a task page
               implies ownership a shared checkout can't claim. */
            <p className="mb-2 text-xs text-fg-faint">
              This run worked directly in the project checkout, so these are that
              tree&apos;s uncommitted changes — not necessarily all from this task.
            </p>
          )}
          {open ? (
            <div className="scroll-thin max-h-72 overflow-auto">
              <ChangesList
                projectId={projectId}
                taskId={taskId}
                changes={list.changes}
              />
            </div>
          ) : (
            <p className="font-mono text-xs text-fg-subtle">
              {list.changes.files.length} file
              {list.changes.files.length === 1 ? "" : "s"} ·{" "}
              <span className="text-ok">+{list.changes.totalAdded}</span>{" "}
              <span className="text-danger">−{list.changes.totalDeleted}</span>
            </p>
          )}
        </div>
      ) : null}
    </CardSection>
  );
}
