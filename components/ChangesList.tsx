"use client";

import { useState } from "react";
import type { GitChanges } from "@/lib/git";
import { DiffModal } from "./DiffModal";

/** Renders an uncommitted-changes summary; clicking a file opens its diff.
 *  The whole list is handed to the modal so it can step through the files without the user
 *  closing and reopening it once per file. */
export function ChangesList({
  projectId,
  member,
  taskId,
  changes,
}: {
  projectId: string;
  member?: string;
  /** Scope the diffs to this task's working dir (see `DiffModal`). Omitted on the project
   *  page, where the list is the project checkout's own uncommitted state. */
  taskId?: string;
  changes: GitChanges;
}) {
  // The *index*, not the path: it is what prev/next moves, and the modal reads the path off
  // the same list, so the two can't disagree about which file is open.
  const [selected, setSelected] = useState<number | null>(null);

  if (changes.files.length === 0)
    return <p className="text-sm text-fg-faint">Working tree clean.</p>;

  const paths = changes.files.map((f) => f.path);
  // Clamped at render rather than corrected in an effect (which this build forbids): the
  // server can hand down a shorter list while the modal is open.
  const open = selected === null ? null : Math.min(selected, paths.length - 1);

  return (
    <div>
      <div className="mb-2 font-mono text-xs text-fg-subtle">
        {changes.files.length} file{changes.files.length === 1 ? "" : "s"} ·{" "}
        <span className="text-ok">+{changes.totalAdded}</span>{" "}
        <span className="text-danger">−{changes.totalDeleted}</span>
      </div>
      <div className="space-y-0.5">
        {changes.files.map((f, i) => (
          <button
            key={f.path}
            onClick={() => setSelected(i)}
            title={`${f.path} — view diff`}
            className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left font-mono text-xs hover:bg-hover"
          >
            <span className="w-16 shrink-0 text-fg-faint">{f.status}</span>
            <span className="min-w-0 flex-1 truncate text-fg hover:text-accent-hover">
              {f.path}
            </span>
            <span className="shrink-0 text-ok">+{f.added}</span>
            <span className="shrink-0 text-danger">−{f.deleted}</span>
          </button>
        ))}
        {changes.truncated > 0 && (
          <p className="px-1 text-xs text-fg-faint">
            …and {changes.truncated} more
          </p>
        )}
      </div>

      {open !== null && (
        <DiffModal
          projectId={projectId}
          member={member}
          taskId={taskId}
          path={paths[open]}
          nav={{ files: paths, index: open, onNavigate: setSelected }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
