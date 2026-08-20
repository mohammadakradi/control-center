"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns2, Loader2, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/segmented";
import { DiffView, type DiffViewMode } from "@/components/DiffView";

/** The file list the modal can move through, supplied by whoever opened it. */
export type DiffNav = {
  /** Every path in the list, in the order they're shown. */
  files: string[];
  /** Which one is open. */
  index: number;
  onNavigate: (index: number) => void;
};

const VIEW_OPTIONS = [
  {
    value: "unified" as const,
    label: "Unified view",
    icon: <Rows3 className="size-4" aria-hidden="true" />,
  },
  {
    value: "split" as const,
    label: "Split view",
    icon: <Columns2 className="size-4" aria-hidden="true" />,
  },
];

/**
 * Fetch and render one file's diff.
 *
 * Mounted with `key={path}` by the modal, so moving to the next file gets fresh state instead
 * of the previous file's diff sitting on screen until the new one lands. The alternative —
 * resetting `diff`/`err` when the prop changes — would be `setState` inside an effect, which
 * is a hard error in this build.
 */
function DiffBody({
  projectId,
  member,
  taskId,
  path,
  view,
}: {
  projectId: string;
  member?: string;
  /** Diff the file in this task's own working dir — a parallel run executes in an
   *  isolated git worktree, so its changes aren't in the project checkout at all. */
  taskId?: string;
  path: string;
  view: DiffViewMode;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ path });
    if (member) params.set("member", member);
    if (taskId) params.set("task", taskId);
    let cancelled = false;
    fetch(`/api/projects/${projectId}/diff?${params.toString()}`)
      .then((r) => r.json())
      .then((d: { diff?: string; error?: string }) => {
        if (cancelled) return;
        if (typeof d.diff === "string") setDiff(d.diff);
        else setErr(d.error ?? "Could not load diff");
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // `taskId` belongs here even though the modal remounts this body on `path`: a task-scoped
    // panel and a project-scoped one can name the same path, and only this changes.
  }, [projectId, member, taskId, path]);

  if (err)
    return (
      <p role="alert" className="p-3 text-sm text-danger">
        {err}
      </p>
    );
  if (diff === null)
    return (
      <p className="inline-flex items-center gap-2 p-3 text-sm text-fg-faint">
        <Loader2 className="size-4 animate-spin" /> Loading diff…
      </p>
    );
  if (diff.trim() === "")
    return (
      <p className="p-3 text-sm text-fg-faint">
        No diff available for this file.
      </p>
    );
  return <DiffView diff={diff} path={path} view={view} />;
}

/** One file's uncommitted diff, with a unified/split toggle and — when the caller supplies the
 *  list it was opened from — prev/next navigation, so reviewing ten files isn't ten round
 *  trips through the modal. */
export function DiffModal({
  projectId,
  member,
  taskId,
  path,
  nav,
  onClose,
}: {
  projectId: string;
  member?: string;
  /** Diff the file in this task's own working dir — a parallel run executes in an
   *  isolated git worktree, so its changes aren't in the project checkout at all. */
  taskId?: string;
  path: string;
  nav?: DiffNav;
  onClose: () => void;
}) {
  const [view, setView] = useState<DiffViewMode>("unified");
  const canNavigate = nav !== undefined && nav.files.length > 1;

  // `nav` is a fresh object literal on every parent render, so the shortcut effect reads it
  // through a ref instead of listing it as a dependency — the same reason `Modal` holds
  // `onClose` in one. Re-subscribing a document listener on every SSE tick is how the live
  // task view ends up with a keydown handler per token.
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });

  /**
   * Move by `delta`, wrapping at both ends.
   *
   * Wrapping rather than disabling the button at the last file is deliberate: `disabled`
   * removes the element from the tab order, and a browser drops focus to `<body>` when the
   * element that has it becomes disabled — so a keyboard user pressing Next through a list
   * would be dumped back to the top of the page on the final press. The counter and the live
   * region make the wrap obvious.
   */
  const go = useCallback((delta: number) => {
    const current = navRef.current;
    if (!current || current.files.length < 2) return;
    const next =
      (current.index + delta + current.files.length) % current.files.length;
    current.onNavigate(next);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // Nothing in this dialog takes text today, but a bracket typed into a future filter
      // field must not page through files.
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      )
        return;
      if (e.key === "[") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        go(1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);

  const previous = nav?.files[(nav.index - 1 + nav.files.length) % nav.files.length];
  const next = nav?.files[(nav.index + 1) % nav.files.length];

  return (
    <Modal
      label={`Diff for ${path}`}
      // `title` because this row now holds up to five controls beside the path, so at phone
      // widths the path is the thing that gives — and a sighted mouse user otherwise has no
      // way back to the full name. (A screen reader gets it from the live region either way.)
      header={
        <span title={path} className="truncate font-mono text-sm text-fg">
          {path}
        </span>
      }
      onClose={onClose}
      // Split view needs the width; unified reads better without it.
      className={view === "split" ? "max-w-6xl" : "max-w-4xl"}
      actions={
        <>
          {canNavigate && (
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => go(-1)}
                aria-label="Previous file"
                title={`Previous file ([) — ${previous}`}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <span className="hidden text-xs tabular-nums text-fg-faint sm:inline">
                {`${nav.index + 1} / ${nav.files.length}`}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => go(1)}
                aria-label="Next file"
                title={`Next file (]) — ${next}`}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}
          <SegmentedControl
            value={view}
            onChange={setView}
            ariaLabel="Diff layout"
            iconOnly
            options={VIEW_OPTIONS}
          />
        </>
      }
    >
      {/* The dialog's accessible name changes when you navigate, but a changed name isn't
          announced — so the move is spoken here instead. */}
      <p className="sr-only" aria-live="polite">
        {canNavigate
          ? `File ${nav.index + 1} of ${nav.files.length}: ${path}`
          : ""}
      </p>
      {/* A scrollable box with no focusable content in it can't be scrolled by keyboard at
          all, so it is a tab stop with a name of its own (WCAG 2.1.1). It matters more here
          than it did before: a diff is now rows rather than one selectable `<pre>`. */}
      <div
        role="region"
        aria-label={`Diff for ${path}`}
        tabIndex={0}
        className="scroll-thin overflow-auto bg-sunken p-3"
      >
        <DiffBody
          key={path}
          projectId={projectId}
          member={member}
          taskId={taskId}
          path={path}
          view={view}
        />
      </div>
    </Modal>
  );
}
