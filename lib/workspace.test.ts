/**
 * Specs for `resolveMemberSlot` — the check that decides whether a workspace member may become a
 * `bypassPermissions` session's cwd, and what slot it holds. Built on a real tree, because every
 * rule is decided by real paths: a declared member list comes from `.swe/workspace.json`, which
 * anything in the tree can rewrite, so each case below is a list an attacker could have written.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMemberSlot } from "./workspace";

const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-slot-")));
const base = join(root, "aw");
for (const d of ["portal/.git", "frontend/.git", "plain", "portal/sub", "../outside/.git"]) {
  mkdirSync(join(base, d), { recursive: true });
}
symlinkSync(join(root, "outside"), join(base, "escape")); // a sibling link pointing out
after(() => rmSync(root, { recursive: true, force: true }));

const project = (members: string[]) => ({
  path: join(base, "portal"),
  isWorkspace: true,
  members: members.map((path) => ({ path })),
});

test("a declared sibling or root repo resolves to its real path", () => {
  const p = project([".", "./", "../frontend"]);
  assert.deepEqual(resolveMemberSlot(p, "."), { ok: true, dir: join(base, "portal") });
  assert.deepEqual(resolveMemberSlot(p, "../frontend"), { ok: true, dir: join(base, "frontend") });
  // Two spellings of one repo are one slot — the reason slots are real paths.
  assert.deepEqual(resolveMemberSlot(p, "./"), resolveMemberSlot(p, "."));
});

test("being declared is not enough", () => {
  const p = project(["/etc", root, "..", "../..", "../escape", "../plain", "./sub", "../missing"]);
  const reason = (rel: string) => {
    const r = resolveMemberSlot(p, rel);
    return r.ok ? "" : r.reason;
  };
  assert.match(reason("/etc"), /relative path/);
  assert.match(reason(root), /relative path/);
  assert.match(reason(".."), /outside the workspace/, "the parent folder itself holds every repo");
  assert.match(reason("../.."), /outside the workspace/);
  assert.match(reason("../escape"), /outside the workspace/, "a symlink is judged by where it lands");
  assert.match(reason("../plain"), /not a git repository/);
  assert.match(reason("./sub"), /not a git repository/, "a subfolder shares its parent's index");
  assert.match(reason("../missing"), /doesn't exist/);
});

test("undeclared members and non-workspaces are refused", () => {
  assert.match(
    (resolveMemberSlot(project(["."]), "../frontend") as { reason: string }).reason,
    /not name a repo/,
  );
  assert.match(
    (resolveMemberSlot({ ...project(["."]), isWorkspace: false }, ".") as { reason: string }).reason,
    /only meaningful on a workspace/,
  );
});
