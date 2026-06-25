"use client";

import { useState } from "react";
import { GitBranch, TriangleAlert } from "lucide-react";
import { GitControls } from "./GitControls";
import { ChangesList } from "./ChangesList";
import { Chip } from "./ui-cards";
import type { ResolvedMember } from "@/lib/workspace";

/** Per-member source control for a workspace: a tab per repo, each with its own
 *  branch switcher, pull/push, and uncommitted changes. */
export function WorkspaceSourceControl({
  projectId,
  members,
}: {
  projectId: string;
  members: ResolvedMember[];
}) {
  const [active, setActive] = useState(0);
  const m = members[active] ?? members[0];
  if (!m) return null;
  const changed = m.changes?.files.length ?? 0;

  return (
    <div>
      {/* Tabs */}
      <div className="-mb-px flex flex-wrap gap-1 border-b border-neutral-800">
        {members.map((mm, i) => {
          const n = mm.changes?.files.length ?? 0;
          const on = i === active;
          return (
            <button
              key={mm.rel}
              onClick={() => setActive(i)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
                on
                  ? "border-sky-500 text-white"
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {mm.name}
              {mm.isRoot && (
                <span className="rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">
                  root
                </span>
              )}
              {n > 0 && (
                <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-300">
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active member */}
      <div className="pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {m.branch?.current && (
            <Chip icon={<GitBranch className="size-3" />}>{m.branch.current}</Chip>
          )}
          <span className="min-w-0 break-all font-mono text-xs text-neutral-600">
            {m.path}
          </span>
        </div>
        {m.role && (
          <p className="mb-3 text-xs leading-relaxed text-neutral-400">{m.role}</p>
        )}

        {!m.exists ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-amber-300">
            <TriangleAlert className="size-4" /> Path not found — is the repo
            cloned?
          </p>
        ) : !m.isGit ? (
          <p className="text-sm text-neutral-500">Not a git repository.</p>
        ) : (
          <>
            {m.branch && (
              <GitControls
                key={m.rel}
                projectId={projectId}
                info={m.branch}
                member={m.rel}
              />
            )}
            <div className="mt-4 border-t border-neutral-800 pt-4">
              {changed > 0 ? (
                <ChangesList
                  projectId={projectId}
                  member={m.rel}
                  changes={m.changes!}
                />
              ) : (
                <p className="text-sm text-neutral-500">Working tree clean.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
