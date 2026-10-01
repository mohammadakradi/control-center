/**
 * The file-tool guard for a run scoped to one workspace member.
 *
 * A member-scoped run shares its workspace with runs on the *other* members, live at the same
 * time (`slotsConflict` in ./worktree). Its cwd and its preamble keep it in its own repo; this
 * makes the file tools refuse to write into a sibling repo the slot doesn't cover — where
 * another session may be editing right now.
 *
 * Deliberately narrow, and worth stating plainly: **this is a guardrail against an agent
 * wandering, not a security boundary.** `Bash` can write anywhere (`sed -i`, `>`, `git -C`),
 * and policing a shell command's effects is not something a pre-check can do honestly. What
 * it does refuse is the common case — Edit/Write/MultiEdit/NotebookEdit aimed at the wrong
 * repo — with a reason the agent reads and can act on. Paths outside every member (scratch
 * dirs, the agent's own memory) are none of its business and pass untouched.
 */
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";

/** The SDK's file-writing tools, and the input field each one names its target in. */
const WRITE_TOOLS: Record<string, string> = {
  Edit: "file_path",
  Write: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/** The PreToolUse matcher for exactly the tools above. */
export const MEMBER_GUARD_MATCHER = Object.keys(WRITE_TOOLS).join("|");

/**
 * Why this tool call must not run, or null to let it through.
 *
 * The owner of a path is the **most specific** member directory containing it, so a member
 * nested inside another (a root "." holding "frontend/") still owns its own subtree. Both the
 * target and the members are compared by real path, so a symlink inside the run's own repo
 * pointing into a sibling is judged by where it lands — and a file that doesn't exist yet by
 * its nearest existing ancestor.
 */
export function memberWriteRefusal(opts: {
  ownDir: string;
  memberDirs: string[];
  cwd: string;
  toolName: string;
  toolInput: unknown;
}): string | null {
  const field = WRITE_TOOLS[opts.toolName];
  if (!field) return null;
  const raw = (opts.toolInput as Record<string, unknown> | null)?.[field];
  if (typeof raw !== "string" || !raw) return null; // malformed: the tool itself will refuse it

  const target = realish(isAbsolute(raw) ? raw : resolve(opts.cwd, raw));
  const own = realish(opts.ownDir);
  let owner: string | null = null;
  for (const dir of opts.memberDirs.map(realish)) {
    if (isInside(dir, target) && (!owner || dir.length > owner.length)) owner = dir;
  }
  if (!owner || owner === own) return null;
  return (
    `This task is scoped to the repo at ${opts.ownDir}; ${raw} belongs to another member of ` +
    "the workspace, which may have its own task running in it right now. Make this change " +
    "inside your own repo, or tell the user it needs a separate task on that repo."
  );
}

/** The real path of `p`, or of its nearest existing ancestor with the rest re-appended — so a
 *  file about to be created resolves through any symlinked directory above it. */
function realish(p: string): string {
  const abs = resolve(p);
  let head = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(head), ...tail.reverse());
    } catch {
      const up = dirname(head);
      if (up === head) return abs;
      tail.push(head.slice(up.length).replace(/^[/\\]+/, ""));
      head = up;
    }
  }
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}
