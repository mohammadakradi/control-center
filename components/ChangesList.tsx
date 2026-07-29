"use client";

import { useState } from "react";
import type { GitChanges } from "@/lib/git";
import { DiffModal } from "./DiffModal";

/** Renders an uncommitted-changes summary; clicking a file opens its diff. */
export function ChangesList({
  projectId,
  member,
  changes,
}: {
  projectId: string;
  member?: string;
  changes: GitChanges;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (changes.files.length === 0)
    return <p className="text-sm text-fg-faint">Working tree clean.</p>;

  return (
    <div>
      <div className="mb-2 font-mono text-xs text-fg-subtle">
        {changes.files.length} file{changes.files.length === 1 ? "" : "s"} ·{" "}
        <span className="text-ok">+{changes.totalAdded}</span>{" "}
        <span className="text-danger">−{changes.totalDeleted}</span>
      </div>
      <div className="space-y-0.5">
        {changes.files.map((f) => (
          <button
            key={f.path}
            onClick={() => setSelected(f.path)}
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

      {selected && (
        <DiffModal
          projectId={projectId}
          member={member}
          path={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
