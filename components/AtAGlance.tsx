import { Activity, Boxes, FileDiff, GitBranch, GitCommitHorizontal } from "lucide-react";
import type { BranchInfo } from "@/lib/git";
import { CardSection, Fact, Tile } from "./ui-cards";

/** "At a glance" summary card: run stats + a short facts list describing the
 *  project's git/workspace state. Single-repo and workspace projects show a
 *  different first fact. */
export function AtAGlance({
  total,
  successRate,
  inProgress,
  changedFiles,
  isWorkspace,
  memberCount,
  branchInfo,
  aheadBehind,
}: {
  total: number;
  successRate: number;
  inProgress: number;
  changedFiles: number;
  isWorkspace: boolean;
  memberCount: number;
  branchInfo: BranchInfo | null;
  /** Pre-formatted ahead/behind summary, or "up to date" / null. */
  aheadBehind: string | null;
}) {
  return (
    <CardSection
      title="At a glance"
      right={<Activity className="size-4 text-neutral-500" />}
    >
      <div className="grid grid-cols-2 gap-3">
        <Tile value={String(total)} label="Tasks run" />
        <Tile
          value={total ? `${successRate}%` : "—"}
          label="Success rate"
          tone="ok"
        />
      </div>
      <ul className="mt-4 flex flex-col">
        {isWorkspace ? (
          <Fact icon={<Boxes className="size-3.5" />} tag={`${memberCount}`}>
            Workspace of <b className="text-neutral-200">{memberCount}</b> member
            repos
          </Fact>
        ) : (
          branchInfo && (
            <Fact
              icon={<GitBranch className="size-3.5" />}
              tag={aheadBehind ?? undefined}
              tagTone={aheadBehind === "up to date" ? "ok" : "warn"}
            >
              {branchInfo.tracking ? (
                <>
                  Tracking{" "}
                  <b className="break-all text-neutral-200">
                    {branchInfo.tracking}
                  </b>
                </>
              ) : (
                "No upstream branch set"
              )}
            </Fact>
          )
        )}
        <Fact
          icon={<FileDiff className="size-3.5" />}
          tag={changedFiles ? "uncommitted" : "clean"}
          tagTone={changedFiles ? "warn" : "ok"}
        >
          {changedFiles ? (
            <>
              <b className="text-neutral-200">{changedFiles}</b> file
              {changedFiles === 1 ? "" : "s"} changed
              {isWorkspace ? " across repos" : ""}
            </>
          ) : (
            "Working tree clean"
          )}
        </Fact>
        <Fact
          icon={<GitCommitHorizontal className="size-3.5" />}
          tag={inProgress ? "running" : undefined}
          tagTone="warn"
        >
          <b className="text-neutral-200">{inProgress}</b> task
          {inProgress === 1 ? "" : "s"} in progress
        </Fact>
      </ul>
    </CardSection>
  );
}
