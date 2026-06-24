import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projects, type WorkspaceMember } from "../db/schema";

export type ProjectScan = {
  name: string;
  path: string;
  isGit: boolean;
  defaultBranch: string | null;
  onboarded: boolean;
  isWorkspace: boolean;
  members: WorkspaceMember[];
};

function gitDefaultBranch(dir: string): string | null {
  const head = resolve(dir, ".git/HEAD");
  try {
    const ref = readFileSync(head, "utf8").trim();
    const m = ref.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : ref.slice(0, 12); // detached HEAD → short sha
  } catch {
    return null;
  }
}

function readWorkspaceMembers(dir: string): WorkspaceMember[] {
  try {
    const cfg = JSON.parse(
      readFileSync(resolve(dir, ".swe/workspace.json"), "utf8"),
    ) as { members?: WorkspaceMember[] };
    return Array.isArray(cfg.members) ? cfg.members : [];
  } catch {
    return [];
  }
}

/** Inspect a local folder and derive its project metadata. */
export function scanProject(rawPath: string): ProjectScan {
  const path = resolve(rawPath.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const isGit = existsSync(resolve(path, ".git"));
  const isWorkspace = existsSync(resolve(path, ".swe/workspace.json"));
  return {
    name: basename(path),
    path,
    isGit,
    defaultBranch: isGit ? gitDefaultBranch(path) : null,
    onboarded: existsSync(resolve(path, "CLAUDE.md")),
    isWorkspace,
    members: isWorkspace ? readWorkspaceMembers(path) : [],
  };
}

export function pathExists(rawPath: string): boolean {
  const path = resolve(rawPath.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  return existsSync(path);
}

/**
 * Re-scan a registered project from disk and persist its derived fields
 * (onboarded, git, workspace). Returns the fresh row, or null if unknown.
 * Keeps the stored state in sync after a task (e.g. onboard) changes the
 * working tree, so the UI reflects reality without a manual rescan.
 */
export function refreshProject(id: string) {
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return null;
  const scan = scanProject(project.path);
  db.update(projects)
    .set({
      isGit: scan.isGit,
      defaultBranch: scan.defaultBranch,
      onboarded: scan.onboarded,
      isWorkspace: scan.isWorkspace,
      members: scan.members,
    })
    .where(eq(projects.id, id))
    .run();
  return db.select().from(projects).where(eq(projects.id, id)).get();
}
