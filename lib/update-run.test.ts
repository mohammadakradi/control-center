/**
 * Specs for the record an update attempt leaves behind.
 *
 * Two writers have to agree on one file: `record_update` in `infra/release/control-center.sh`
 * and `markUpdateStarted` here. So the last test runs the real script — an update against an
 * empty `CC_HOME` gets as far as `need_install` and dies, which needs no network and no
 * install, and exercises every part of the recording path at once.
 *
 * The rest is what a reader must not take on trust: `state=running` is a claim about a process
 * that may be long gone, and the file itself is written by another process and served on a
 * route with no auth in front of it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ccHome,
  markUpdateStarted,
  openAttemptLog,
  parseStatusFile,
  readUpdateRun,
  updateRunPaths,
} from "./update-run";

/** A `~/.control-center` with the two directories an attempt writes into. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "cc-update-"));
  mkdirSync(join(dir, "run"), { recursive: true });
  mkdirSync(join(dir, "logs"), { recursive: true });
  return dir;
}

const env = (dir: string) => ({ CC_HOME: dir });

/** Unix seconds, as the shell's `date +%s` writes them. A `running` record is only believed
 *  while it's young (see the age-ceiling spec), so "now" is part of most fixtures. */
const nowSeconds = () => Math.floor(Date.now() / 1_000);

function writeStatus(
  dir: string,
  fields: Record<string, string | number>,
): void {
  writeFileSync(
    join(dir, "run/update.status"),
    Object.entries(fields)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

test("ccHome prefers CC_HOME, then the install's data directory", () => {
  assert.equal(
    ccHome({ CC_HOME: "/opt/cc", PLATFORM_DATA_DIR: "/nope/data" }),
    "/opt/cc",
  );
  assert.equal(
    // What a server spawned by a CLI too old to export CC_HOME still has.
    ccHome({ PLATFORM_DATA_DIR: "/home/u/.control-center/data" }),
    "/home/u/.control-center",
  );
  assert.match(ccHome({}), /\.control-center$/);
});

test("no attempt yet is no record, not an error", () => {
  assert.equal(readUpdateRun({ env: env(home()) }), null);
});

test("a failed attempt reports its reason and the end of its log", () => {
  const dir = home();
  writeFileSync(
    join(dir, "logs/update.log"),
    "Downloading 0.7.0…\n\n\x1b[31mBuilding the app…\x1b[0m\n" +
      "error: build failed — the existing install is untouched.\n",
  );
  writeStatus(dir, {
    state: "failed",
    pid: process.pid,
    from: "0.6.0",
    target: "0.7.0",
    startedAt: 1_000,
    endedAt: 1_200,
    message: "build failed — the existing install is untouched.",
  });

  const run = readUpdateRun({ env: env(dir), currentVersion: "0.6.0" });
  assert.equal(run?.state, "failed");
  assert.equal(run?.from, "0.6.0");
  assert.equal(run?.target, "0.7.0");
  assert.equal(run?.startedAt, 1_000_000, "seconds on disk, ms in JSON");
  assert.equal(run?.endedAt, 1_200_000);
  assert.match(run?.message ?? "", /^build failed/);
  assert.equal(run?.stale, false, "0.7.0 is still ahead of us");
  assert.equal(run?.logPath, join(dir, "logs/update.log"));
  assert.match(run?.logTail ?? "", /error: build failed/);
  assert.ok(!/\x1b/.test(run?.logTail ?? ""), "colour codes stripped");
  assert.ok(!/\n\n/.test(run?.logTail ?? ""), "blank lines dropped");
});

test("a record claiming to run is only running while its process is", () => {
  const dir = home();
  writeStatus(dir, { state: "running", pid: process.pid, startedAt: nowSeconds() });
  assert.equal(readUpdateRun({ env: env(dir) })?.state, "running");
  // Injected rather than hunting for a genuinely dead pid: the branch is the point, and a
  // "surely nothing owns this number" pid is exactly the flake it looks like.
  assert.equal(
    readUpdateRun({ env: env(dir), pidAlive: () => false })?.state,
    "crashed",
    "a run that died without recording an outcome — the case that replaced a 6-minute timeout",
  );
});

test("a record with no usable pid can't hold the apply route hostage", () => {
  const dir = home();
  writeStatus(dir, { state: "running", pid: "", startedAt: nowSeconds() });
  assert.equal(
    readUpdateRun({ env: env(dir) })?.state,
    "crashed",
    "both writers always record a pid, so a missing one is a file nobody here wrote — and " +
      "reading it as `running` would refuse every retry forever",
  );
});

test("the log tail rides along only where it diagnoses something", () => {
  const dir = home();
  writeFileSync(join(dir, "logs/update.log"), "Installing dependencies…\n");
  const cases = [
    ["failed", true],
    ["succeeded", false],
    ["up-to-date", false],
    ["running", false],
  ] as const;
  for (const [state, expected] of cases) {
    writeStatus(dir, { state, pid: process.pid, startedAt: nowSeconds() });
    const run = readUpdateRun({ env: env(dir) });
    assert.equal(run?.logTail !== null, expected, `${state} carries a tail: ${expected}`);
  }
});

test("the tail is the end of a long log, cut on a line boundary", () => {
  const dir = home();
  const lines = Array.from({ length: 4_000 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
  writeFileSync(join(dir, "logs/update.log"), lines.join("\n") + "\n");
  writeStatus(dir, { state: "failed", pid: 1, startedAt: 1_000 });

  const tail = readUpdateRun({ env: env(dir) })?.logTail ?? "";
  assert.ok(tail.length <= 2_000, `capped, got ${tail.length}`);
  assert.match(tail, /line 3999/, "the end is what matters");
  assert.ok(!tail.includes("line 0 "), "the start is not in there");
  assert.ok(
    tail.split("\n").every((line) => /^line \d+ x+$/.test(line)),
    "no half line survives the byte-level cut",
  );
});

test("an attempt that targeted a version we already run is stale", () => {
  const dir = home();
  writeStatus(dir, {
    state: "failed",
    pid: 1,
    target: "0.7.0",
    startedAt: 1_000,
    endedAt: 1_001,
  });
  const stale = (currentVersion: string) =>
    readUpdateRun({ env: env(dir), currentVersion })?.stale;
  assert.equal(stale("0.7.0"), true, "a later start already applied it");
  assert.equal(stale("0.8.0"), true, "we're past it");
  assert.equal(stale("0.6.9"), false, "still pending");
});

test("an unusable record is no record at all", () => {
  const dir = home();
  const status = join(dir, "run/update.status");

  writeFileSync(status, "state=exploded\npid=1\n");
  assert.equal(readUpdateRun({ env: env(dir) }), null, "a state we never write");

  writeFileSync(status, "who knows what this is\n");
  assert.equal(readUpdateRun({ env: env(dir) }), null, "not the format");

  writeFileSync(status, `state=failed\npid=1\npadding=${"x".repeat(9_000)}\n`);
  assert.equal(readUpdateRun({ env: env(dir) }), null, "far bigger than anything we write");
});

test("parseStatusFile keeps the first value for a repeated key", () => {
  const record = parseStatusFile("state=failed\nmessage=real\nstate=succeeded\n");
  assert.equal(record.state, "failed");
  assert.equal(record.message, "real");
});

/**
 * The three escapes, all found by the security audit against the first version of this reader,
 * which had `O_NOFOLLOW` and nothing else. Each needs a different check, and the planted files
 * are real — the point is what the syscalls do, not what the code reads like.
 *
 * Note what is *inside* the root being defended: `~/.control-center/.env` holds
 * `SECRETS_MASTER_KEY` and `data/secrets/` holds the encrypted tokens. So containment alone
 * isn't the bar here — a link that stays inside the root is refused too, unlike
 * `readBytesInside`, which serves project files where an internal symlink is ordinary.
 */
test("a symlink standing in for the record is refused, inside the root or not", () => {
  const RECORD = "state=failed\npid=1\nstartedAt=1\nmessage=leaked\n";
  const outside = mkdtempSync(join(tmpdir(), "cc-outside-"));
  writeFileSync(join(outside, "planted"), RECORD);

  for (const where of ["inside", "outside"] as const) {
    const dir = home();
    const planted = where === "inside" ? join(dir, "planted") : join(outside, "planted");
    if (where === "inside") writeFileSync(planted, RECORD);
    symlinkSync(planted, join(dir, "run/update.status"));
    assert.equal(
      readUpdateRun({ env: env(dir) }),
      null,
      `a symlink pointing ${where} the root must not be followed — .env is in this root too`,
    );
  }
});

test("a symlinked directory above the file is refused", () => {
  // O_NOFOLLOW only guards the last component, so this one walks straight through it. The
  // audit read a planted file this way through `logs`, on an unauthenticated route.
  const dir = mkdtempSync(join(tmpdir(), "cc-update-"));
  const outside = mkdtempSync(join(tmpdir(), "cc-outside-"));
  mkdirSync(join(dir, "run"), { recursive: true });
  writeFileSync(join(outside, "update.log"), "SECRET the log never held\n");
  symlinkSync(outside, join(dir, "logs")); // logs/ itself is the link
  writeStatus(dir, { state: "failed", pid: 1, startedAt: 1_000 });

  const run = readUpdateRun({ env: env(dir) });
  assert.equal(run?.state, "failed", "the record itself is still readable");
  assert.equal(run?.logTail, null, "but nothing is read through the redirected directory");

  // And the same shape over the record's own directory.
  const other = mkdtempSync(join(tmpdir(), "cc-update-"));
  mkdirSync(join(other, "logs"), { recursive: true });
  writeFileSync(join(outside, "update.status"), "state=failed\npid=1\nstartedAt=1\n");
  symlinkSync(outside, join(other, "run"));
  assert.equal(readUpdateRun({ env: env(other) }), null);
});

test("a hard link in place of the log is refused", () => {
  // No target to resolve, so realpath swears it lives exactly where it appears — `nlink` is the
  // only thing that sees it, and `~/.control-center/.env` is on the same filesystem.
  const dir = home();
  const outside = mkdtempSync(join(tmpdir(), "cc-outside-"));
  writeFileSync(join(outside, "secret"), "SECRETS_MASTER_KEY=hunter2\n");
  linkSync(join(outside, "secret"), join(dir, "logs/update.log"));
  writeStatus(dir, { state: "failed", pid: 1, startedAt: 1_000 });

  const run = readUpdateRun({ env: env(dir) });
  assert.equal(run?.state, "failed");
  assert.equal(run?.logTail, null, "a second name for the file is the tell");
});

test("a record can't claim to be running forever", () => {
  // Pid numbers get recycled, so a reboot can leave a record naming a pid that now belongs to
  // something else. Believing it means the apply route refuses every retry — the exact "the
  // button does nothing" failure this work exists to remove. The audit reproduced it with pid 1.
  const dir = home();
  const started = 1_700_000_000_000;
  writeStatus(dir, { state: "running", pid: process.pid, startedAt: started / 1_000 });
  const at = (now: number) =>
    readUpdateRun({ env: env(dir), now, pidAlive: () => true })?.state;

  assert.equal(at(started + 60_000), "running", "a minute in, of course it's running");
  assert.equal(at(started + 59 * 60_000), "running", "an update can genuinely take a while");
  assert.equal(at(started + 61 * 60_000), "crashed", "but not an hour and a half");

  // The other end of the window, which an upper bound alone misses: a negative age is under any
  // ceiling, so the re-audit re-wedged the route with `pid=1` and a stamp dated next century.
  assert.equal(at(started - 60_000), "running", "a minute of clock correction is tolerated");
  assert.equal(at(started - 6 * 60_000), "crashed", "a start time that hasn't happened yet");
  assert.equal(
    at(started - 100 * 365 * 24 * 60 * 60_000),
    "crashed",
    "the audit's own PoC: dated a century ahead, believed forever by an upper bound alone",
  );
});

test("a running record with no start time at all is not believed", () => {
  // Same conjunction as the missing-pid case: nothing to bound it with, so it can't hold the
  // apply route's refusal open.
  const dir = home();
  for (const startedAt of ["", "not-a-number", "-5"]) {
    writeStatus(dir, { state: "running", pid: process.pid, startedAt });
    assert.equal(
      readUpdateRun({ env: env(dir), pidAlive: () => true })?.state,
      "crashed",
      `startedAt=${JSON.stringify(startedAt)}`,
    );
  }
  writeFileSync(join(dir, "run/update.status"), `state=running\npid=${process.pid}\n`);
  assert.equal(
    readUpdateRun({ env: env(dir), pidAlive: () => true })?.state,
    "crashed",
    "the field absent entirely",
  );
});

test("a FIFO left in place of the log doesn't hang the read", () => {
  const dir = home();
  // O_NONBLOCK is what makes this return at all: a plain open on a FIFO waits for a writer,
  // and it does so before fstat gets to say it isn't a file.
  execFileSync("mkfifo", [join(dir, "logs/update.log")]);
  writeStatus(dir, { state: "failed", pid: 1, startedAt: 1_000 });

  const run = readUpdateRun({ env: env(dir) });
  assert.equal(run?.state, "failed");
  assert.equal(run?.logTail, null);
});

test("the route's own first record reads back, directories and all", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-update-bare-"));
  const now = 1_700_000_000_000;
  markUpdateStarted({ pid: process.pid, from: "0.6.0", env: env(dir), now });

  const run = readUpdateRun({ env: env(dir), currentVersion: "0.6.0", now });
  assert.equal(run?.state, "running");
  assert.equal(run?.from, "0.6.0");
  assert.equal(run?.target, null, "the script fills that in once it knows");
  assert.equal(run?.startedAt, now);
  assert.equal(run?.endedAt, null);
  assert.equal(run?.stale, false);
  assert.equal(
    readUpdateRun({ env: env(dir), now, pidAlive: () => false })?.state,
    "crashed",
    "a child that never actually ran must not read as an update in progress",
  );
});

test("each attempt gets the log to itself", () => {
  const dir = home();
  // World-readable, as a manual run's `tee` leaves it under the default umask.
  writeFileSync(join(dir, "logs/update.log"), "output from the attempt before\n", {
    mode: 0o644,
  });

  const log = openAttemptLog(env(dir));
  assert.equal(log.path, updateRunPaths(env(dir)).log);
  writeSync(log.fd, "Downloading 0.7.0…\n");
  closeSync(log.fd);

  const text = readFileSync(log.path, "utf8");
  assert.ok(!text.includes("attempt before"), "the previous attempt's output is gone");
  assert.match(text, /control-center update started/, "the route got this far");
  assert.match(text, /Downloading 0\.7\.0/);
  assert.equal(
    statSync(log.path).mode & 0o777,
    0o600,
    "narrowed even though the file already existed — `mode` on write only applies to a new one",
  );
});

test("the previous attempt is kept, not destroyed by the next one", () => {
  // A real failure was undiagnosable because of this: the update log is truncated per attempt,
  // so the successful retry someone runs to recover overwrote the only transcript of why the
  // first one failed. One generation back is enough — the interesting log is always the
  // failure immediately before the retry.
  const dir = home();
  const logPath = join(dir, "logs/update.log");
  writeFileSync(logPath, "build failed — the reason nobody got to read\n", { mode: 0o644 });

  const log = openAttemptLog(env(dir));
  closeSync(log.fd);

  const prev = readFileSync(`${logPath}.prev`, "utf8");
  assert.match(prev, /the reason nobody got to read/, "the failed attempt survived the retry");
  assert.ok(
    !readFileSync(logPath, "utf8").includes("nobody got to read"),
    "and the current log is still a clean slate for this attempt",
  );
});

test("a first-ever attempt has nothing to keep and still opens cleanly", () => {
  // No log yet: the rename must not turn a fresh install's first update into an error.
  const dir = home();
  const log = openAttemptLog(env(dir));
  writeSync(log.fd, "Downloading…\n");
  closeSync(log.fd);
  assert.match(readFileSync(log.path, "utf8"), /control-center update started/);
  assert.equal(existsSync(`${log.path}.prev`), false, "nothing invented to rotate");
});

/**
 * The other writer, end to end. `update` against an empty CC_HOME reaches `need_install` and
 * dies: no network, nothing installed, and the whole recording path runs — the tee into
 * logs/update.log, `die` → `record_update`, and the non-zero exit a scripted caller depends on,
 * which the tee pipeline would otherwise swallow (a pipeline exits with tee's status).
 */
const SCRIPT = resolve(import.meta.dirname, "../infra/release/control-center.sh");

function runScript(
  dir: string,
  extra: Record<string, string> = {},
): { status: number; output: string } {
  try {
    const stdout = execFileSync("sh", [SCRIPT, "update"], {
      env: { ...process.env, HOME: dir, CC_HOME: dir, ...extra },
      encoding: "utf8",
      stdio: "pipe",
    });
    return { status: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("control-center.sh records a failed attempt and still exits non-zero", () => {
  const dir = home();
  const { status } = runScript(dir);
  assert.equal(status, 1, "a failed update must not report success");

  const run = readUpdateRun({ env: env(dir), currentVersion: "0.6.0" });
  assert.equal(run?.state, "failed");
  assert.match(run?.message ?? "", /no install found/, "die's own words");
  assert.equal(run?.target, null, "it never got as far as knowing one");
  assert.ok((run?.startedAt ?? 0) > 0, "stamped");
  assert.ok((run?.endedAt ?? 0) >= (run?.startedAt ?? 0));
  assert.equal(run?.stale, false, "no target, nothing to compare");
  assert.match(run?.logTail ?? "", /no install found/, "and it was teed into the log");
});

test("CC_UPDATE_LOG tells the script its output is already captured", () => {
  const dir = home();
  const { status, output } = runScript(dir, {
    CC_UPDATE_LOG: join(dir, "logs/update.log"),
  });

  assert.equal(status, 1);
  assert.match(output, /no install found/, "the caller's capture gets everything");
  assert.equal(
    existsSync(join(dir, "logs/update.log")),
    false,
    "and the script writes no second copy of it",
  );
  assert.equal(
    readUpdateRun({ env: env(dir) })?.state,
    "failed",
    "the outcome is recorded either way",
  );
});
