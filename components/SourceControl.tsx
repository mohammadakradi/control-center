import { FileDiff } from "lucide-react";
import type { BranchInfo, GitChanges } from "@/lib/git";
import type { ResolvedMember } from "@/lib/workspace";
import { CardSection } from "./ui-cards";
import { GitControls } from "./GitControls";
import { ChangesList } from "./ChangesList";
import { WorkspaceSourceControl } from "./WorkspaceSourceControl";

/** Source-control card: per-member tabs for a workspace, or a single-repo
 *  branch switcher + uncommitted changes list otherwise. */
export function SourceControl({
  projectId,
  isWorkspace,
  members,
  branchInfo,
  changes,
}: {
  projectId: string;
  isWorkspace: boolean;
  members: ResolvedMember[];
  branchInfo: BranchInfo | null;
  changes: GitChanges | null;
}) {
  // Nothing to show for a non-workspace project with no git branch info.
  if (!isWorkspace && !branchInfo) return null;

  return (
    <CardSection title="Source control">
      {isWorkspace ? (
        <WorkspaceSourceControl projectId={projectId} members={members} />
      ) : (
        branchInfo && (
          <>
            <GitControls projectId={projectId} info={branchInfo} />
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-fg-muted">
                <FileDiff className="size-4 text-fg-faint" />
                Changes
              </div>
              {changes && changes.files.length > 0 ? (
                <>
                  <div className="scroll-thin max-h-72 overflow-auto">
                    <ChangesList projectId={projectId} changes={changes} />
                  </div>
                  <p className="mt-3 text-xs text-fg-faint">
                    Run{" "}
                    <span className="font-mono text-accent">/swe:ship</span> to
                    commit these changes and open a PR.
                  </p>
                </>
              ) : (
                <p className="text-sm text-fg-faint">Working tree clean.</p>
              )}
            </div>
          </>
        )
      )}
    </CardSection>
  );
}
