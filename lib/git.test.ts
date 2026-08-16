/**
 * Specs for `gitShowFile` — the read path for a finished parallel task's committed files
 * after its worktree is cleaned up. Against a real temp repo: what matters is git's own
 * behavior for refs, missing paths, and the leading-dash guard.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitShowFile } from "./git";

const root = mkdtempSync(join(tmpdir(), "platform-git-test-"));
const repo = join(root, "repo");

const git = (args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

before(() => {
  mkdirSync(repo);
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@test"]);
  git(["config", "user.name", "test"]);
  writeFileSync(join(repo, "doc.md"), "on main\n");
  git(["add", "-A"]);
  git(["commit", "-m", "init"]);
  git(["checkout", "-b", "task/abc123"]);
  writeFileSync(join(repo, "doc.md"), "on the task branch\n");
  writeFileSync(join(repo, "only-on-branch.md"), "branch-only file\n");
  git(["add", "-A"]);
  git(["commit", "-m", "task work"]);
  git(["checkout", "main"]);
});

after(() => rmSync(root, { recursive: true, force: true }));

test("reads a file at a branch that isn't checked out", () => {
  assert.equal(gitShowFile(repo, "task/abc123", "doc.md"), "on the task branch\n");
  assert.equal(gitShowFile(repo, "task/abc123", "only-on-branch.md"), "branch-only file\n");
  assert.equal(gitShowFile(repo, "main", "doc.md"), "on main\n");
});

test("unknown ref, missing path, or non-repo cwd → null, never a throw", () => {
  assert.equal(gitShowFile(repo, "task/nope", "doc.md"), null);
  assert.equal(gitShowFile(repo, "task/abc123", "not-there.md"), null);
  assert.equal(gitShowFile(root, "main", "doc.md"), null);
});

test("a ref that could read as a git option is refused", () => {
  assert.equal(gitShowFile(repo, "--help", "doc.md"), null);
  assert.equal(gitShowFile(repo, "-", "doc.md"), null);
  assert.equal(gitShowFile(repo, "", "doc.md"), null);
});
