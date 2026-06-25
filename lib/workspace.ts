import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
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
