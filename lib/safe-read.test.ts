/**
 * Specs for the contained-read primitives.
 *
 * These are the defence for the file and diff routes, which read a caller-supplied relative
 * path under a tree the user registered — and which, for a parallel task, is a git worktree
 * an agent with Bash just wrote. So the tests plant the real thing: real symlinks, a real
 * hard link, a real FIFO. Each of the three escapes defeats at least one of the obvious
 * single-check fixes, which is why they are all here.
 *
 * Note the tree is realpath'd before use: on macOS `mkdtemp` hands back a path under `/var`,
 * which is a symlink to `/private/var`, so a root that isn't resolved makes every contained
 * file look like an escape.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  escapesOnDisk,
  isSameSoleFile,
  isUsableRelPath,
  readBytesInside,
  readFileInside,
} from "./safe-read";

const SECRET = "PRIVATE-KEY-BODY\nsecond-line\n";
const MAX = 512 * 1024;

let base: string;
let repo: string;
let outside: string;

before(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "safe-read-")));
  repo = join(base, "repo");
  outside = join(base, "outside");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(outside, { recursive: true });

  writeFileSync(join(outside, "id_rsa"), SECRET);
  writeFileSync(join(repo, "plain.md"), "in the repo\n");
  writeFileSync(join(repo, "docs", "real.md"), "nested and real\n");

  // The three escapes.
  symlinkSync(join(outside, "id_rsa"), join(repo, "leak-file.md")); // final component
  symlinkSync(outside, join(repo, "leak-dir")); // intermediate directory
  linkSync(join(outside, "id_rsa"), join(repo, "leak-hard.md")); // hard link

  // A symlink that stays inside the repo — legitimate, must keep working.
  symlinkSync(join(repo, "docs", "real.md"), join(repo, "inside-link.md"));
});

after(() => rmSync(base, { recursive: true, force: true }));

test("reads a plain file inside the root", () => {
  const r = readFileInside(repo, "plain.md", MAX);
  assert.equal(r.ok && r.content, "in the repo\n");
});

test("reads through a symlink that stays inside the root", () => {
  // Deliberately allowed: `README.md -> docs/README.md` is an ordinary thing for a repo to
  // contain. Escaping the root is the thing being refused, not links as such.
  const r = readFileInside(repo, "inside-link.md", MAX);
  assert.equal(r.ok && r.content, "nested and real\n");
});

test("refuses a symlink pointing out of the root", () => {
  const r = readFileInside(repo, "leak-file.md", MAX);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "invalid");
});

test("refuses a path through a symlinked directory", () => {
  // The case an O_NOFOLLOW-only fix misses: O_NOFOLLOW rejects a symlink as the *final*
  // component, and `leak-dir` is an intermediate one.
  const r = readFileInside(repo, "leak-dir/id_rsa", MAX);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "invalid");
});

test("refuses a hard link to a file outside the root", () => {
  // The case realpath alone misses: a hard link has no target to resolve, so it reports as
  // living exactly where it appears. Only the link count gives it away.
  const r = readFileInside(repo, "leak-hard.md", MAX);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "invalid");
});

test("no refusal leaks the secret's content", () => {
  for (const p of ["leak-file.md", "leak-dir/id_rsa", "leak-hard.md"]) {
    const r = readFileInside(repo, p, MAX);
    assert.equal(JSON.stringify(r).includes("PRIVATE-KEY"), false, p);
  }
});

test("refuses traversal and absolute paths", () => {
  for (const p of ["../outside/id_rsa", "docs/../../outside/id_rsa", "/etc/hosts"]) {
    const r = readFileInside(repo, p, MAX);
    assert.equal(r.ok, false, p);
  }
});

test("a missing file is not-found, not invalid", () => {
  // The distinction the routes rely on to keep answering 404 for an ordinary typo.
  const r = readFileInside(repo, "nope.md", MAX);
  assert.equal(r.ok === false && r.reason, "not-found");
});

test("a file over the cap is too-large, and is not read", () => {
  writeFileSync(join(repo, "big.md"), "x".repeat(64));
  const r = readFileInside(repo, "big.md", 32);
  assert.equal(r.ok === false && r.reason, "too-large");
});

test("refuses a directory", () => {
  assert.equal(readFileInside(repo, "docs", MAX).ok, false);
});

test("refuses a FIFO instead of blocking on it", () => {
  // A FIFO read blocks until someone writes, i.e. takes the request with it. The check has
  // to happen before the read — if this test hangs, it has regressed.
  execFileSync("mkfifo", [join(repo, "pipe")]);
  const r = readFileInside(repo, "pipe", MAX);
  assert.equal(r.ok, false);
  rmSync(join(repo, "pipe"));
});

test("a missing root is not-found rather than a throw", () => {
  assert.equal(readFileInside(join(base, "gone"), "x.md", MAX).ok, false);
});

test("isUsableRelPath rejects the shapes the routes must not accept", () => {
  for (const bad of ["", "/abs", "../up", "a/../../b", "a\nb", "a\u0000b", null, undefined])
    assert.equal(isUsableRelPath(bad), false, JSON.stringify(bad));
  for (const good of ["a.md", "docs/a.md", "a..b.md", "..hidden.md"])
    assert.equal(isUsableRelPath(good), true, good);
});

test("escapesOnDisk: contained files pass, escapes are refused", () => {
  assert.equal(escapesOnDisk(repo, "plain.md"), false);
  assert.equal(escapesOnDisk(repo, "inside-link.md"), false);
  assert.equal(escapesOnDisk(repo, "leak-file.md"), true);
  assert.equal(escapesOnDisk(repo, "leak-dir/id_rsa"), true);
  assert.equal(escapesOnDisk(repo, "leak-hard.md"), true);
  assert.equal(escapesOnDisk(repo, "../outside/id_rsa"), true);
});

test("escapesOnDisk allows a contained directory", () => {
  // A git submodule is a directory, and `git diff HEAD -- <submodule>` is an ordinary diff.
  // Refusing every non-regular file here silently produced an empty diff for every
  // submodule in every project.
  assert.equal(escapesOnDisk(repo, "docs"), false);
});

/**
 * The identity check, tested deterministically — because the race test below cannot test it.
 * Removing the `dev`/`ino` comparison and keeping only the post-open containment re-check
 * leaves every timing-based test passing (verified, twice, independently), so without these
 * assertions a future edit could silently drop the one clause that closes the window.
 */
test("isSameSoleFile accepts only the same, singly-linked file", () => {
  const base = { dev: 1, ino: 42, nlink: 1 };
  assert.equal(isSameSoleFile(base, { dev: 1, ino: 42, nlink: 1 }), true);

  // A different file at the contained path — the directory was swapped and put back.
  assert.equal(isSameSoleFile(base, { dev: 1, ino: 43, nlink: 1 }), false);
  // Same inode number on another device: `ino` alone is not an identity.
  assert.equal(isSameSoleFile(base, { dev: 2, ino: 42, nlink: 1 }), false);
  // The hard-link bypass: identical file, but a second name now exists for it.
  assert.equal(isSameSoleFile(base, { dev: 1, ino: 42, nlink: 2 }), false);
  // ...and the same in the other direction, when the handle already had two names.
  assert.equal(
    isSameSoleFile({ dev: 1, ino: 42, nlink: 2 }, { dev: 1, ino: 42, nlink: 2 }),
    false,
  );
});

/**
 * Concurrency smoke test for the check→open race: a background shell swaps `racy` between a
 * real directory and a symlink pointing outside while this loop reads `racy/real.md`. Every
 * read must either return the contained content or be refused — never the secret.
 *
 * **Be honest about what a green run means.** This does *not* prove the inode check works: I
 * disabled that check and this test still passed, because the post-open `realpath` alone
 * already refuses the common interleaving, and the residual window (symlink at open, real
 * directory again by the post-check) is only a couple of syscalls wide — a review measured
 * roughly 2 hits per 640k attempts, far beyond what 3 seconds here samples. What actually
 * closes that window is the argument in `readFileInside`: `nlink === 1` plus "the inode at
 * the contained path is the inode I hold" leaves the handle nowhere else to point. This test
 * guards against a regression that *widens* the window back to something easily hit — which
 * is exactly what the old `git diff --no-index` subprocess was.
 */
test("no leak while a directory component is swapped for a symlink", () => {
  const dir = join(repo, "racy");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "real.md"), "contained\n");
  writeFileSync(join(outside, "real.md"), SECRET);

  const swap = spawn(
    "sh",
    [
      "-c",
      `while :; do mv "${dir}" "${dir}.bak" 2>/dev/null; ln -s "${outside}" "${dir}" 2>/dev/null; ` +
        `rm -f "${dir}" 2>/dev/null; mv "${dir}.bak" "${dir}" 2>/dev/null; done`,
    ],
    { stdio: "ignore" },
  );

  try {
    let leaks = 0;
    let served = 0;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const r = readFileInside(repo, "racy/real.md", MAX);
      if (r.ok) {
        served += 1;
        if (r.content.includes("PRIVATE-KEY")) leaks += 1;
      }
    }
    assert.equal(leaks, 0, `leaked the outside file ${leaks} time(s)`);
    // Guard against the test proving nothing because every read happened to be refused.
    assert.ok(served > 0, "no read ever succeeded — the race test proved nothing");
  } finally {
    swap.kill("SIGKILL");
    rmSync(`${dir}.bak`, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(outside, "real.md"), { force: true });
  }
});

test("readBytesInside returns the bytes undecoded, and the handle's mode", () => {
  // The diff path writes this back out for git to compare, so a UTF-8 round trip would make
  // two different files look identical (every unmappable byte becomes the same replacement
  // character). The mode comes off `fstat` on the open handle rather than a second `stat` of
  // the path, so it describes the file that was actually read.
  const raw = Buffer.from([0xff, 0xfe, 0x0a]);
  writeFileSync(join(repo, "raw.bin"), raw);
  chmodSync(join(repo, "raw.bin"), 0o755);

  const r = readBytesInside(repo, "raw.bin", MAX);
  assert.ok(r.ok);
  assert.deepEqual(r.bytes, raw);
  assert.equal(r.mode & 0o100, 0o100);
  // The utf8 wrapper is still what every text caller gets.
  assert.equal(readFileInside(repo, "raw.bin", MAX).ok, true);
});

test("readBytesInside refuses the same escapes as readFileInside", () => {
  for (const p of ["leak-file.md", "leak-dir/id_rsa", "leak-hard.md"])
    assert.equal(readBytesInside(repo, p, MAX).ok, false, p);
});

test("escapesOnDisk allows a path with nothing on disk", () => {
  // `git diff HEAD -- deleted.md` is a legitimate diff of a file that no longer exists; git
  // reads it from the object store, so there is no filesystem read to escape through.
  assert.equal(escapesOnDisk(repo, "deleted.md"), false);
});
