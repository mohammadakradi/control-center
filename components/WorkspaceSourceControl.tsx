"use client";

import { useId, useRef, useState } from "react";
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
  const baseId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const m = members[active] ?? members[0];
  if (!m) return null;
  const changed = m.changes?.files.length ?? 0;

  const tabId = (i: number) => `${baseId}-tab-${i}`;
  const panelId = (i: number) => `${baseId}-panel-${i}`;

  // Roving focus: ←/→ move between repos, Home/End jump to the ends.
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next = active;
    if (delta) next = (active + delta + members.length) % members.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = members.length - 1;
    else return;
    e.preventDefault();
    setActive(next);
    tabsRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  return (
    <div>
      {/* Tabs */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Workspace repositories"
        onKeyDown={onTabKeyDown}
        className="-mb-px flex flex-wrap gap-1 border-b border-line"
      >
        {members.map((mm, i) => {
          const n = mm.changes?.files.length ?? 0;
          const on = i === active;
          return (
            <button
              key={mm.rel}
              type="button"
              role="tab"
              id={tabId(i)}
              aria-selected={on}
              aria-controls={panelId(i)}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
                on
                  ? "border-accent text-fg-strong"
                  : "border-transparent text-fg-subtle hover:text-fg"
              }`}
            >
              {mm.name}
              {mm.isRoot && (
                <span className="rounded bg-surface-3 px-1 py-0.5 text-[10px] text-fg-subtle">
                  root
                </span>
              )}
              {n > 0 && (
                <span
                  className="rounded-full bg-warn-soft px-1.5 text-[10px] font-medium text-warn"
                  aria-label={`${n} uncommitted file${n === 1 ? "" : "s"}`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active member */}
      <div
        role="tabpanel"
        id={panelId(active)}
        aria-labelledby={tabId(active)}
        tabIndex={0}
        className="pt-4"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {m.branch?.current && (
            <Chip icon={<GitBranch className="size-3" />}>{m.branch.current}</Chip>
          )}
          <span className="min-w-0 break-all font-mono text-xs text-fg-ghost">
            {m.path}
          </span>
        </div>
        {m.role && (
          <p className="mb-3 text-xs leading-relaxed text-fg-subtle">{m.role}</p>
        )}

        {!m.exists ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-warn">
            <TriangleAlert className="size-4" /> Path not found — is the repo
            cloned?
          </p>
        ) : !m.isGit ? (
          <p className="text-sm text-fg-faint">Not a git repository.</p>
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
            <div className="mt-4 border-t border-line pt-4">
              {changed > 0 ? (
                // Height-capped to match the single-repo path in `SourceControl`,
                // so a member with many changed files doesn't run off the card.
                <div className="scroll-thin max-h-72 overflow-auto">
                  <ChangesList
                    projectId={projectId}
                    member={m.rel}
                    changes={m.changes!}
                  />
                </div>
              ) : (
                <p className="text-sm text-fg-faint">Working tree clean.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
