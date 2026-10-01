/**
 * Specs for the member-scoped file-tool guard — the one thing stopping a run on one workspace
 * member from editing a sibling repo another session may be working in. Built on a real
 * directory tree (including a symlink), because the containment is decided by real paths.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEMBER_GUARD_MATCHER, memberWriteRefusal } from "./member-guard";

const root = mkdtempSync(join(tmpdir(), "member-guard-"));
const portal = join(root, "portal");
const frontend = join(root, "portal-frontend");
const nested = join(portal, "docs-site"); // a member nested inside the root member
for (const d of [portal, frontend, nested, join(root, "scratch")]) mkdirSync(d, { recursive: true });
// A link inside the portal repo that points into the frontend repo.
symlinkSync(frontend, join(portal, "fe-link"));
after(() => rmSync(root, { recursive: true, force: true }));

const members = [portal, frontend, nested];
const check = (ownDir: string, toolName: string, toolInput: unknown, cwd = ownDir) =>
  memberWriteRefusal({ ownDir, memberDirs: members, cwd, toolName, toolInput });

test("writes inside the run's own repo pass, including files that don't exist yet", () => {
  assert.equal(check(frontend, "Edit", { file_path: join(frontend, "src/App.vue") }), null);
  assert.equal(check(frontend, "Write", { file_path: "new/dir/file.ts" }), null, "relative to cwd");
  assert.equal(check(portal, "Write", { file_path: join(portal, "app/x.php") }), null);
});

test("writes into a sibling member are refused, by absolute path or by `..`", () => {
  assert.match(check(portal, "Edit", { file_path: join(frontend, "src/App.vue") }) ?? "", /another member/);
  assert.match(check(portal, "Write", { file_path: "../portal-frontend/x.ts" }) ?? "", /another member/);
  assert.match(
    check(frontend, "NotebookEdit", { notebook_path: join(portal, "n.ipynb") }) ?? "",
    /another member/,
  );
  assert.match(check(frontend, "MultiEdit", { file_path: join(portal, "a") }) ?? "", /another member/);
});

test("a symlink is judged by where it lands, not by where it sits", () => {
  assert.match(
    check(portal, "Write", { file_path: join(portal, "fe-link/src/evil.ts") }) ?? "",
    /another member/,
  );
});

test("the most specific member owns a nested subtree", () => {
  // docs-site is its own member even though it sits inside the portal root.
  assert.match(check(portal, "Write", { file_path: join(nested, "index.md") }) ?? "", /another member/);
  assert.equal(check(nested, "Write", { file_path: join(nested, "index.md") }), null);
  assert.match(check(nested, "Write", { file_path: join(portal, "composer.json") }) ?? "", /another member/);
});

test("paths outside every member, other tools and malformed input are none of its business", () => {
  assert.equal(check(portal, "Write", { file_path: join(root, "scratch/notes.md") }), null);
  assert.equal(check(portal, "Write", { file_path: "/tmp/x" }), null);
  assert.equal(check(portal, "Read", { file_path: join(frontend, "src/App.vue") }), null);
  assert.equal(check(portal, "Bash", { command: `rm -rf ${frontend}` }), null, "Bash is out of scope, by design");
  assert.equal(check(portal, "Edit", {}), null);
  assert.equal(check(portal, "Edit", null), null);
  assert.equal(check(portal, "Edit", { file_path: 42 }), null);
});

test("the matcher covers exactly the guarded tools", () => {
  assert.deepEqual(MEMBER_GUARD_MATCHER.split("|").sort(), ["Edit", "MultiEdit", "NotebookEdit", "Write"]);
});
