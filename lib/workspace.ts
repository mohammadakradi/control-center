import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import type { Project } from "./db/schema";
import {
  gitBranchInfo,
  gitChanges,
  type BranchInfo,
  type GitChanges,
} from "./git";

export type ResolvedMember = {
  rel: string; // path as stored in workspace.json, e.g. "." or "../portal-frontend"
  path: string; // resolved absolute path
  name: string; // display name (basename)
  role?: string;
  exists: boolean;
  isGit: boolean;
  isRoot: boolean;
  branch: BranchInfo | null;
  changes: GitChanges | null;
};

/** Resolve a workspace's member repos and gather each one's git state. */
export function resolveMembers(project: Project): ResolvedMember[] {
  if (!project.isWorkspace) return [];
  return project.members.map((m) => {
    const path = resolve(project.path, m.path);
    const exists = existsSync(path);
    const isGit = exists && existsSync(resolve(path, ".git"));
    return {
      rel: m.path,
      path,
      name: m.path === "." ? basename(project.path) : basename(path),
      role: m.role,
      exists,
      isGit,
      isRoot: m.path === ".",
      branch: isGit ? gitBranchInfo(path) : null,
      changes: isGit ? gitChanges(path) : null,
    };
  });
}

/** Resolve a member's absolute path, but only if it's a declared member (guards the git API). */
export function memberPath(project: Project, rel: string): string | null {
  if (!project.isWorkspace) return null;
  const m = project.members.find((x) => x.path === rel);
  return m ? resolve(project.path, m.path) : null;
}

export type MemberSlot = { ok: true; dir: string } | { ok: false; reason: string };

/**
 * Can a task be scoped to member `rel` of this workspace, and if so, what is its slot — the
 * member's **real path**? The one definition, used at dispatch (`memberRefusal`) and again by
 * the runner at actual launch, since a queued task can outlive the member list it was
 * dispatched against (the project page re-syncs `members` from disk on every render).
 *
 * `members` comes from the project's own `.swe/workspace.json`, which anything with write
 * access to that tree — including an agent's Bash — can change, so being declared is not
 * enough. The resolved directory becomes a `bypassPermissions` session's cwd, so it must also:
 * - be declared with a **relative** path (an absolute one makes `resolve` ignore the root);
 * - be an existing directory **inside the workspace's parent folder** — where a workspace's
 *   sibling repos live (`../portal-frontend`) — compared by real path, so a symlink can't
 *   carry it out;
 * - be **its own git repo**: a slot is "one checkout", and a plain subfolder of another member
 *   would share that member's index and HEAD.
 *
 * The real path is also what slots are compared by (`slotsConflict`), so "." and "./" — or a
 * member declared twice under two spellings — are one slot, not two.
 */
export function resolveMemberSlot(
  project: Pick<Project, "path" | "isWorkspace" | "members">,
  rel: string,
): MemberSlot {
  if (!project.isWorkspace)
    return { ok: false, reason: "member is only meaningful on a workspace project — this one is a single repo." };
  if (!project.members.some((m) => m.path === rel))
    return { ok: false, reason: "member does not name a repo declared in this workspace." };
  if (isAbsolute(rel))
    return { ok: false, reason: "a workspace member must be declared with a relative path." };
  let dir: string;
  let parent: string;
  try {
    dir = realpathSync(resolve(project.path, rel));
    parent = dirname(realpathSync(project.path));
    if (!statSync(dir).isDirectory()) throw new Error("not a directory");
  } catch {
    return { ok: false, reason: `the repo for member ${rel} doesn't exist any more.` };
  }
  if (dir === parent || !dir.startsWith(parent.endsWith(sep) ? parent : parent + sep))
    return { ok: false, reason: `member ${rel} resolves outside the workspace's folder.` };
  if (!existsSync(resolve(dir, ".git")))
    return { ok: false, reason: `member ${rel} is not a git repository of its own.` };
  return { ok: true, dir };
}
