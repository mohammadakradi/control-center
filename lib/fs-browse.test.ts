/**
 * Unit tests for the folder-picker's directory listing. The interesting part is the jail:
 * the picker exposes a slice of the server's filesystem to any signed-in user, so "outside
 * the roots" must fail closed — including via `..`, and including on macOS where temp dirs
 * (and `/tmp`) are symlinks, so a naive string prefix check would wrongly reject paths that
 * really are inside a root.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { FsBrowseError, browseRoots, listDirectories } from "./fs-browse";

/** A throwaway tree that looks like a projects folder. */
function makeTree() {
  const base = mkdtempSync(join(tmpdir(), "fs-browse-"));
  const root = join(base, "Dev");
  mkdirSync(join(root, "alpha", ".git"), { recursive: true });
  mkdirSync(join(root, "beta", "nested"), { recursive: true });
  mkdirSync(join(root, "Gamma"), { recursive: true });
  mkdirSync(join(root, ".hidden"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(base, "outside"), { recursive: true });
  writeFileSync(join(root, "notes.txt"), "not a folder");
  return { base, root, outside: join(base, "outside") };
}

const savedEnv = { roots: process.env.PROJECT_ROOTS, home: process.env.HOME };
const cleanup: string[] = [];

function withRoots(...roots: string[]) {
  // Same separator the library splits on, so this spec is meaningful on Windows too.
  process.env.PROJECT_ROOTS = roots.join(delimiter);
}

test.afterEach(() => {
  process.env.PROJECT_ROOTS = savedEnv.roots;
  process.env.HOME = savedEnv.home;
});

test.after(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });
});

function tree() {
  const t = makeTree();
  cleanup.push(t.base);
  return t;
}

/** `assert.throws` returns nothing, and the status is the whole point here. */
function refusal(fn: () => unknown, why: string): FsBrowseError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof FsBrowseError, `${why}: got ${err}`);
    return err;
  }
  assert.fail(`${why}: nothing was thrown`);
}

test("lists only real sub-directories, alphabetically, hidden + node_modules skipped", () => {
  const { root } = tree();
  withRoots(root);
  const listing = listDirectories(root);
  assert.deepEqual(
    listing.entries.map((e) => e.name),
    ["alpha", "beta", "Gamma"],
  );
  assert.equal(listing.truncated, false);
});

test("flags folders that are git repos", () => {
  const { root } = tree();
  withRoots(root);
  const listing = listDirectories(root);
  assert.deepEqual(
    listing.entries.map((e) => [e.name, e.isGit]),
    [
      ["alpha", true],
      ["beta", false],
      ["Gamma", false],
    ],
  );
});

test("no path requested → starts at the first existing root, which has no parent", () => {
  const { root, base } = tree();
  withRoots(join(base, "does-not-exist"), root);
  const listing = listDirectories();
  assert.equal(realpathSync(listing.path), realpathSync(root));
  assert.equal(listing.parent, null, "a root is the ceiling — no navigating above it");
});

test("descending reports the parent so the UI can walk back up", () => {
  const { root } = tree();
  withRoots(root);
  const listing = listDirectories(join(root, "beta"));
  assert.deepEqual(
    listing.entries.map((e) => e.name),
    ["nested"],
  );
  assert.equal(listing.parent, root);
});

test("with a wider root above it, a narrower root is no longer the ceiling", () => {
  const { root, base } = tree();
  // Mirrors the real config (`$HOME:/Users`): you start in the narrow root but can still
  // walk up into the wider one, and only stop where the widest root ends.
  withRoots(root, base);
  assert.equal(listDirectories(root).parent, base, "up from the start folder still works");
  assert.equal(listDirectories(base).parent, null, "…but not past the outermost root");
});

test("a path outside every root is refused with 403", () => {
  const { root, outside } = tree();
  withRoots(root);
  assert.equal(refusal(() => listDirectories(outside), "sibling of the root").status, 403);
});

test("`..` cannot escape the jail", () => {
  const { root } = tree();
  withRoots(root);
  for (const attempt of [`${root}/../outside`, `${root}/beta/../../..`, "/etc"]) {
    assert.equal(refusal(() => listDirectories(attempt), attempt).status, 403);
  }
});

test("a root reached through a symlinked path still counts as the root", () => {
  const { root } = tree();
  // macOS: tmpdir() is /var/folders/… which is a symlink to /private/var/folders/….
  // Configure the root by its real path, then request the symlinked spelling.
  withRoots(realpathSync(root));
  const listing = listDirectories(root);
  assert.equal(listing.parent, null);
  assert.equal(listing.entries.length, 3);
});

test("a missing folder inside a root is 404, a file is 400", () => {
  const { root } = tree();
  withRoots(root);
  const missing = refusal(() => listDirectories(join(root, "nope")), "missing folder");
  assert.equal(missing.status, 404);

  const file = refusal(() => listDirectories(join(root, "notes.txt")), "a file, not a dir");
  assert.equal(file.status, 400);
});

test("~ in a requested path expands to the home directory", () => {
  const { root } = tree();
  withRoots(root);
  process.env.HOME = root;
  const listing = listDirectories("~/beta");
  assert.equal(listing.path, resolve(root, "beta"));
});

test("browseRoots: PROJECT_ROOTS wins, is delimiter-separated and deduped", () => {
  const { root, outside } = tree();
  withRoots(root, outside, root);
  assert.deepEqual(browseRoots(), [root, outside]);
});

test("browseRoots: a configured root that doesn't exist is dropped, not offered", () => {
  const { root, base } = tree();
  withRoots(root, join(base, "not-mounted-yet"));
  assert.deepEqual(
    browseRoots(),
    [root],
    "an unmounted drive would otherwise show as a chip that 404s",
  );
});

test("browseRoots: with no env var, home AND the registered projects' parents are roots", () => {
  const { root, base } = tree();
  delete process.env.PROJECT_ROOTS;
  process.env.HOME = base;
  // Both, not one-or-the-other: in a container `homedir()` is `/home/node`, which exists, so
  // treating the project parents as a mere fallback would strand you there with no projects.
  assert.deepEqual(browseRoots([root, join(base, "ghost")]), [base, root]);
});

test("browseRoots: a home that doesn't exist is dropped, not offered as a dead root", () => {
  const { root, base } = tree();
  delete process.env.PROJECT_ROOTS;
  process.env.HOME = join(base, "no-such-home");
  assert.deepEqual(browseRoots([root]), [root]);
});
