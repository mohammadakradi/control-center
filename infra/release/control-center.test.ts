/**
 * The update lock in control-center.sh.
 *
 * Two entry points reach `apply_update()` — the `update` command (which the app's Update
 * button drives) and `check_and_update()` on the `start` path — and before the lock they
 * shared nothing: "click Update, quit the app, reopen it" put two swaps on the same `app/`,
 * and the bad interleavings of their rm/mv end with no app directory at all.
 *
 * These specs run the real script under /bin/sh against a throwaway CC_HOME, with `curl`
 * stubbed on PATH so nothing ever reaches GitHub:
 *   - `up-to-date`  → `{"tag_name":"v0.0.1"}` (older than the fake install's 9.9.9), so `update`
 *                     takes the up-to-date path: every lock transition happens, no download.
 *   - `unreachable` → exits 1, so `update` dies at "couldn't reach GitHub Releases" — how
 *                     release-on-`die` becomes observable.
 *   - `newer`       → `v99.0.0` *with its tarball asset listed*, but the download itself fails,
 *                     so the `start` path actually enters `apply_update` (and thus
 *                     `check_and_update`'s own acquire/release) before dying. The asset has to be
 *                     there or `fetch_latest_release` screens it out and nothing is entered.
 *   - `publishing`  → `v99.0.0` with an empty asset list: a release that exists but can't be
 *                     installed yet, which is the state every real release passes through.
 *   - `slow`        → sleeps before answering, so one process genuinely holds the lock while a
 *                     second races it — the real concurrency the other specs can't reach.
 * Everything asserted here is a behaviour a person would otherwise only see by racing two
 * terminals.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "control-center.sh");

const CURL_STUBS = {
  "up-to-date": '#!/bin/sh\nprintf \'%s\' \'{"tag_name":"v0.0.1"}\'\n',
  unreachable: "#!/bin/sh\nexit 1\n",
  // Newer release exists *and* lists its tarball, but the download 404s (curl exit 22, and
  // `-w '%{http_code}'` prints the status) — so `apply_update` is entered and then dies,
  // exercising the `start`/`check_and_update` acquire+release path. Without the asset entry
  // `fetch_latest_release` refuses it as still publishing and `apply_update` is never reached at all.
  newer:
    '#!/bin/sh\ncase "$*" in\n  *api.github.com*) printf \'%s\' \'{"tag_name":"v99.0.0","assets":[{"name":"control-center-99.0.0.tar.gz","browser_download_url":"https://github.com/o/r/releases/download/v99.0.0/control-center-99.0.0.tar.gz"}]}\' ;;\n  *) printf 404; exit 22 ;;\nesac\n',
  // A release that is published but whose assets haven't uploaded yet: the API answers with the
  // new tag and an empty asset list. Nothing is installable from it.
  publishing:
    '#!/bin/sh\ncase "$*" in\n  *api.github.com*) printf \'%s\' \'{"tag_name":"v99.0.0","assets":[]}\' ;;\n  *) printf 404; exit 22 ;;\nesac\n',
  // Same as `newer`, but the download fails with curl's "couldn't resolve host" — no HTTP
  // response at all, so the failure must not be blamed on a half-published release.
  "newer-network-fail":
    '#!/bin/sh\ncase "$*" in\n  *api.github.com*) printf \'%s\' \'{"tag_name":"v99.0.0","assets":[{"name":"control-center-99.0.0.tar.gz","browser_download_url":"https://github.com/o/r/releases/download/v99.0.0/control-center-99.0.0.tar.gz"}]}\' ;;\n  *) printf 000; exit 6 ;;\nesac\n',
  // …and an HTTP error that isn't a 404. "Wait for the upload" would be wrong advice here.
  "newer-http-500":
    '#!/bin/sh\ncase "$*" in\n  *api.github.com*) printf \'%s\' \'{"tag_name":"v99.0.0","assets":[{"name":"control-center-99.0.0.tar.gz","browser_download_url":"https://github.com/o/r/releases/download/v99.0.0/control-center-99.0.0.tar.gz"}]}\' ;;\n  *) printf 500; exit 22 ;;\nesac\n',
  // A release with NO assets whose *body* tries to forge the asset entry — first the bare
  // filename, then the full download URL, then the whole `"browser_download_url": "…"` pair.
  // The last one is the security audit's spoof of the URL-only gate. JSON escaping is what
  // defeats it: every quote in a body arrives as \\", so the bare quotes the gate matches on
  // cannot appear. Written exactly as GitHub would encode such a body.
  "publishing-prose":
    '#!/bin/sh\ncase "$*" in\n  *api.github.com*) printf \'%s\' \'{"tag_name":"v99.0.0","body":"control-center-99.0.0.tar.gz and https://github.com/o/r/releases/download/v99.0.0/control-center-99.0.0.tar.gz and \\\\"browser_download_url\\\\": \\\\"https://github.com/o/r/releases/download/v99.0.0/control-center-99.0.0.tar.gz\\\\"","assets":[]}\' ;;\n  *) printf 404; exit 22 ;;\nesac\n',
  // Answers the release check, but only after a pause — long enough that a second, concurrent
  // `update` is guaranteed to find the lock held.
  slow: '#!/bin/sh\nsleep 2\nprintf \'%s\' \'{"tag_name":"v0.0.1"}\'\n',
} as const;

// Every makeHome() root, torn down once at the end so the suite doesn't leak temp dirs.
const roots: string[] = [];
after(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** A fake install the script accepts: app/package.json is all `need_install` asks for. */
function makeHome(curl: keyof typeof CURL_STUBS) {
  const root = mkdtempSync(join(tmpdir(), "cc-lock-"));
  roots.push(root);
  const home = join(root, "cc-home");
  mkdirSync(join(home, "app"), { recursive: true });
  writeFileSync(join(home, "app", "package.json"), '{"version":"9.9.9"}\n');
  const bin = join(root, "bin");
  mkdirSync(bin);
  const stub = join(bin, "curl");
  writeFileSync(stub, CURL_STUBS[curl]);
  chmodSync(stub, 0o755);
  const env = {
    ...process.env,
    CC_HOME: home,
    PATH: `${bin}:${process.env.PATH}`,
    CC_NO_OPEN: "1",
    // The asset gate builds the expected download URL from CC_REPO, so the stubs' asset entries
    // have to name the same repo — which is the point: an asset URL pointing somewhere else is
    // not evidence that *this* repo's release has a tarball.
    CC_REPO: "o/r",
  };
  delete (env as Record<string, unknown>).CC_UPDATE_LOG;
  delete (env as Record<string, unknown>).CC_SKIP_UPDATE_CHECK;
  return { home, env };
}

function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  const res = spawnSync("/bin/sh", [SCRIPT, ...args], {
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(res.error, undefined);
  return res;
}

/** Same, but async, so two invocations can genuinely overlap. */
function runAsync(
  env: NodeJS.ProcessEnv,
  ...args: string[]
): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", [SCRIPT, ...args], { env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out }));
  });
}

const lockDir = (home: string) => join(home, "run", "update.lock");
const ownerFile = (home: string) => join(lockDir(home), "owner");

function writeLock(home: string, ownerLine: string) {
  mkdirSync(lockDir(home), { recursive: true });
  writeFileSync(ownerFile(home), `${ownerLine}\n`);
}

function recordedState(home: string): string | null {
  const path = join(home, "run", "update.status");
  if (!existsSync(path)) return null;
  return /^state=(.*)$/m.exec(readFileSync(path, "utf8"))?.[1] ?? null;
}

/** A pid that is certainly dead: a shell that printed its own pid and exited. */
function deadPid(): number {
  const res = spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" });
  const pid = Number.parseInt(res.stdout.trim(), 10);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  return pid;
}

const nowSec = () => Math.floor(Date.now() / 1000);

test("update refuses while another live update holds the lock", () => {
  const { home, env } = makeHome("up-to-date");
  // The test process itself is the "other update": alive for as long as this assertion runs.
  writeLock(home, `${process.pid} ${nowSec()}`);
  const res = run(env, "update");
  assert.equal(res.status, 1);
  // The manual path tees stderr into stdout, so the refusal lands there and in update.log.
  assert.match(res.stdout, /another update is already in progress/);
  assert.match(res.stdout, /update\.log/);
  assert.equal(recordedState(home), "failed");
  // The holder's lock was not stolen.
  assert.equal(
    readFileSync(ownerFile(home), "utf8").split(" ")[0],
    String(process.pid),
  );
});

test("update refuses on the route path too (CC_UPDATE_LOG set, no tee)", () => {
  const { home, env } = makeHome("up-to-date");
  writeLock(home, `${process.pid} ${nowSec()}`);
  const res = run({ ...env, CC_UPDATE_LOG: join(home, "logs", "update.log") }, "update");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /another update is already in progress/);
  assert.equal(recordedState(home), "failed");
});

/**
 * The mid-publish window, from the CLI's side. `release: published` puts the tag on the API
 * immediately; the workflow uploads the tarball minutes later, at the end of its run. Offering
 * that tag meant `apply_update` 404'd on the download and the app's banner reported a failed
 * update — on every release.
 */
test("a release whose assets aren't uploaded yet is not treated as available", () => {
  const { home, env } = makeHome("publishing");
  const res = run(env, "update");
  assert.equal(res.status, 1, "nothing to install, so the attempt stops");
  assert.match(res.stdout, /assets aren't uploaded yet/);
  assert.doesNotMatch(res.stdout, /Downloading/, "apply_update must never be entered");
  assert.doesNotMatch(
    res.stdout,
    /couldn't reach GitHub/,
    "GitHub answered — saying otherwise sends the user after a network fault that isn't there",
  );
  assert.equal(recordedState(home), "failed");
  assert.ok(!existsSync(lockDir(home)), "and the lock is released either way");
});

test("a release body that merely names the tarball doesn't count as having one", () => {
  // There is no jq here, so the gate greps the whole payload — and a payload carries the release
  // *body*, which for our own releases is a generated changelog of PR titles. Matching the bare
  // filename let that prose stand in for a real asset (security audit). Matching the download URL
  // is both tighter and the honest question: is the thing I'm about to fetch actually listed?
  const { home, env } = makeHome("publishing-prose");
  const res = run(env, "update");
  assert.equal(res.status, 1);
  assert.match(res.stdout, /assets aren't uploaded yet/);
  assert.doesNotMatch(res.stdout, /Downloading/, "apply_update must never be entered");
  assert.ok(!existsSync(lockDir(home)));
});

/**
 * The regression the first cut of this guard introduced: screening on the asset *before*
 * comparing versions made an older release with no assets — a fork, or this suite's own
 * up-to-date fixture — report "still publishing" instead of "you're already current", and
 * `update` exited 1 where it used to exit 0.
 *
 * Note for anyone auditing spec value by reverting: this one passes against the *pre-asset-gate*
 * script too, because it pins an **ordering** (version compare before asset check) that the
 * shipped code happens to get right by construction. It is a regression pin against a draft that
 * got it wrong, not a dead spec — reverting the gate makes the other three go red, not this one.
 */
test("an assetless release that isn't newer still reads as up to date", () => {
  const { home, env } = makeHome("up-to-date"); // v0.0.1, no assets, install is 9.9.9
  const res = run(env, "update");
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Already on the latest release/);
  assert.doesNotMatch(res.stdout, /assets aren't uploaded/);
  assert.equal(recordedState(home), "up-to-date");
});

test("a lock whose process is gone is reclaimed, and released again after the run", () => {
  const { home, env } = makeHome("up-to-date");
  writeLock(home, `${deadPid()} ${nowSec()}`);
  const res = run(env, "update");
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Already on the latest release/);
  assert.equal(recordedState(home), "up-to-date");
  assert.ok(!existsSync(lockDir(home)), "the lock must not survive a finished attempt");
});

test("a live pid does not hold the lock past the age ceiling", () => {
  const { home, env } = makeHome("up-to-date");
  // kill -0 can't verify identity, so a recycled pid reads as alive — the ceiling is what
  // keeps that (or a reboot's leftovers) from wedging updates forever.
  writeLock(home, `${process.pid} ${nowSec() - 2 * 3600}`);
  const res = run(env, "update");
  assert.equal(res.status, 0);
  assert.equal(recordedState(home), "up-to-date");
  assert.ok(!existsSync(lockDir(home)));
});

test("a lock dated beyond clock tolerance in the future is stale, not eternal", () => {
  const { home, env } = makeHome("up-to-date");
  // `age < ceiling` alone is satisfied by any negative age — a file dated next century would
  // hold the lock forever. The same shape wedged update.status until its reader got a floor.
  writeLock(home, `${process.pid} ${nowSec() + 3600}`);
  const res = run(env, "update");
  assert.equal(res.status, 0);
  assert.ok(!existsSync(lockDir(home)));
});

test("a non-numeric owner file reads as stale rather than aborting the shell", () => {
  const { home, env } = makeHome("up-to-date");
  // A garbage field must never reach `$(( ))` — an expansion error there kills a
  // non-interactive shell outright, turning one stray write into "updates never run again".
  writeLock(home, "not-a-pid whenever");
  const res = run(env, "update");
  assert.equal(res.status, 0);
  assert.equal(recordedState(home), "up-to-date");
  assert.ok(!existsSync(lockDir(home)));
});

test("an all-digit but oversized owner field does not crash dash", () => {
  const { home, env } = makeHome("up-to-date");
  // 20 digits overflows a 64-bit integer, and under dash `kill -0 <that>` / `$(( ))` are FATAL
  // ("Illegal number", exit 2) — which would bypass `die` and leave the lock crashing every
  // future run. The digit-length bound must reject it before either is evaluated.
  writeLock(home, "1 17300000011730000002");
  const res = run(env, "update");
  assert.doesNotMatch(res.stdout, /Illegal number/);
  assert.notEqual(res.status, 2);
  assert.equal(res.status, 0);
  assert.equal(recordedState(home), "up-to-date");
  assert.ok(!existsSync(lockDir(home)));
});

test("a symlink standing in for the owner file is unlinked, never written through", () => {
  const { home, env } = makeHome("up-to-date");
  // A pre-existing lock dir with a symlinked `owner` is reclaimed, not written into: `mkdir`
  // fails, so flow goes through the `mv`+`rm -rf` reclaim, which unlinks the symlink (never
  // follows it) before any owner write. So the target — ~/.control-center/.env being the prize
  // — is untouched. (This is the reclaim-path defence; the O_EXCL owner write is the separate
  // guard for a symlink planted in the fresh-mkdir→write gap, which isn't deterministically
  // reachable here — see the notes.)
  const secret = join(home, "secret.env");
  writeFileSync(secret, "SECRETS_MASTER_KEY=do-not-touch\n");
  mkdirSync(lockDir(home), { recursive: true });
  symlinkSync(secret, ownerFile(home));
  const res = run(env, "update");
  assert.equal(
    readFileSync(secret, "utf8"),
    "SECRETS_MASTER_KEY=do-not-touch\n",
    "the planted symlink target must be untouched",
  );
  // …and the lock self-heals.
  assert.equal(res.status, 0);
  assert.ok(!existsSync(lockDir(home)));
});

test("start lets the updater's own restart through (same pid holds the lock)", () => {
  const { home, env } = makeHome("up-to-date");
  // update_run holds the lock across its own `cmd_start` restart; that restart runs in the same
  // process, so its $$ matches the owner and cmd_start must NOT refuse it. Emulated with a
  // wrapper that writes the lock under its own pid then exec's the script (exec preserves $$).
  const wrapper = join(home, "restart.sh");
  writeFileSync(
    wrapper,
    [
      "#!/bin/sh",
      'mkdir -p "$CC_HOME/run/update.lock"',
      'printf "%s %s\\n" "$$" "$(date +%s)" > "$CC_HOME/run/update.lock/owner"',
      `exec /bin/sh ${JSON.stringify(SCRIPT)} start --no-update`,
    ].join("\n"),
  );
  const res = spawnSync("/bin/sh", [wrapper], { env, encoding: "utf8", timeout: 30_000 });
  assert.equal(res.error, undefined);
  // It gets past the lock check — proven both by the absence of the refusal and by reaching a
  // later stage (migration, which fails on this fake install for unrelated reasons).
  assert.doesNotMatch(res.stderr, /an update is in progress/);
  assert.match(res.stderr, /migration failed/);
});

test("start refuses while another process is mid-update, even with --no-update", () => {
  const { home, env } = makeHome("up-to-date");
  writeLock(home, `${process.pid} ${nowSec()}`);
  const res = run(env, "start", "--no-update");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /an update is in progress/);
  assert.ok(
    !existsSync(join(home, "run", "web.pid")),
    "a refused start must not have spawned anything",
  );
  // Refusing is not owning: the in-flight update's lock is left alone.
  assert.ok(existsSync(lockDir(home)));
});

test("check_and_update on the start path acquires the lock and releases it when apply fails", () => {
  const { home, env } = makeHome("newer");
  // `start` (with the update check on) finds a newer release, enters apply_update, and dies on
  // the failed download — exercising check_and_update's own acquire and the release-on-die.
  const res = run(env, "start");
  assert.equal(res.status, 1);
  // `start` doesn't tee, so the die message is on stderr. The stub lists the tarball asset but
  // 404s the download itself — the narrow race the asset check can't close — and curl's exit 22
  // is what turns a bare "download failed" into advice the user can act on.
  assert.match(res.stderr, /assets aren't uploaded yet/);
  assert.ok(
    !existsSync(lockDir(home)),
    "a failed apply on the start path must release the lock",
  );
});

test("a download that fails for a non-HTTP reason still says so plainly", () => {
  const { home, env } = makeHome("newer-network-fail");
  // curl exit 6 (host resolution) means there was no HTTP response at all, so blaming a
  // half-published release would send the user off to wait for an upload that already finished.
  const res = run(env, "update");
  assert.equal(res.status, 1);
  assert.match(res.stdout, /download failed/);
  assert.doesNotMatch(res.stdout, /assets aren't uploaded/);
  assert.ok(!existsSync(lockDir(home)));
});

test("an HTTP error that isn't a 404 names the status instead of blaming the upload", () => {
  // "try again in a few minutes" is wrong advice for a 403 or a 5xx — nothing is going to
  // finish uploading. The status is what a user can act on (or report).
  const { home, env } = makeHome("newer-http-500");
  const res = run(env, "update");
  assert.equal(res.status, 1);
  assert.match(res.stdout, /HTTP 500/);
  assert.doesNotMatch(res.stdout, /assets aren't uploaded/);
  assert.ok(!existsSync(lockDir(home)));
});

test("a failed update releases the lock on its way out (die path)", () => {
  const { home, env } = makeHome("unreachable");
  const res = run(env, "update");
  assert.equal(res.status, 1);
  assert.match(res.stdout, /couldn't reach GitHub Releases/);
  assert.equal(recordedState(home), "failed");
  assert.ok(!existsSync(lockDir(home)), "a dead attempt must not wedge the next one");
});

test("an uncontended update takes and releases the lock invisibly", () => {
  const { home, env } = makeHome("up-to-date");
  const res = run(env, "update");
  assert.equal(res.status, 0);
  assert.equal(recordedState(home), "up-to-date");
  assert.ok(!existsSync(lockDir(home)));
});

test("two updates overlapping in time never both hold the lock", async () => {
  // Exclusion under genuine overlap: the slow curl makes one process hold the lock for ~2s
  // while the second races it, so exactly one acquires and the other is refused. (This proves
  // the lock excludes; it does not exercise the sub-millisecond mkdir→owner-write gap, which is
  // closed by construction — the O_EXCL owner write — and can't be hit deterministically here.)
  const { env } = makeHome("slow");
  const [a, b] = await Promise.all([runAsync(env, "update"), runAsync(env, "update")]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [0, 1], "exactly one update must win, the other refuse");
  const loser = a.status === 1 ? a : b;
  assert.match(loser.out, /another update is already in progress/);
});

/**
 * A failed update must never stop the app from starting.
 *
 * `apply_update` ends in `die` on any problem and `die` exits the script — so on the `start`
 * path a bad download meant the server simply never came up. That is much worse than being a
 * version behind, and it needs no attacker: a flaky network during the download did it. (The
 * security audit reached the same state deliberately, via CC_REPO pointing at a fork.)
 */
test("a failed update on the start path warns and still launches", () => {
  const { home, env } = makeHome("newer"); // asset listed, download 404s
  const res = run(env, "start");
  // Combined, because only `cmd_update` tees stderr into stdout; `start` doesn't, so `warn` and
  // `die` land on stderr here.
  const out = res.stdout + res.stderr;
  assert.match(out, /didn't finish/, "it says the update failed");
  assert.match(out, /starting 9\.9\.9 instead/, "…and which version it's carrying on with");
  // Proof it got *past* the update rather than exiting there: the launch continues into the
  // migration step, which is what fails in this fixture (no node_modules in a fake install).
  assert.match(out, /migration failed/);
  assert.ok(!existsSync(lockDir(home)), "and the lock is released, not leaked");
});

test("`control-center update` still fails loudly — only the launch path is forgiving", () => {
  // The asymmetry is deliberate: a command whose whole job is to update must exit non-zero when
  // it couldn't, or a script driving it can't tell. Only `start` swallows the failure.
  const { env } = makeHome("newer");
  const res = run(env, "update");
  assert.equal(res.status, 1);
  assert.doesNotMatch(res.stdout + res.stderr, /starting 9\.9\.9 instead/);
});

/**
 * Two invariants inside `apply_update()` that no runnable spec here can reach.
 *
 * Everything above stops at the download — getting to the build needs a real tarball, a real
 * `pnpm install` and a real Turbopack build, which is minutes of work and not a unit test. But
 * both of these brick an install when they regress, and both are one careless edit away, so
 * they are pinned structurally instead of behaviourally. A structural assertion is the weaker
 * kind; it is here because the alternative is no assertion at all.
 */
test("the app is stopped before the build, not after it", () => {
  // The reason: a Turbopack production build alongside the web server and runner it is about
  // to replace exhausted an 8 GB machine, and the update died partway through loading a
  // module. The same update succeeded with the app closed. If `stop_all` drifts back below
  // the build, that failure returns and is miserable to diagnose.
  const script = readFileSync(SCRIPT, "utf8");
  const body = script.slice(
    script.indexOf("apply_update() {"),
    script.indexOf("\nupdate_run() {"),
  );
  assert.ok(body.length > 0, "found apply_update's body");
  const stop = body.indexOf("stop_all");
  const build = body.indexOf("next build");
  assert.ok(stop > -1 && build > -1, "both steps are still in apply_update");
  assert.ok(stop < build, "stop_all must come before the build");
});

test("the build-failure restart cannot trip `set -u` on the start path", () => {
  // `apply_update` has two callers. `update_run` sets `was_running`; `cmd_start` — applying an
  // update before launching — does not, and the script runs under `set -eu`, so a bare
  // `$was_running` aborts the launch with "unbound variable". That turns a failed update into
  // an app that will not start, which is the exact class of bug the surrounding comments in
  // this script were written about.
  const script = readFileSync(SCRIPT, "utf8");
  assert.match(script, /\$\{was_running:-no\}/, "the reference is defaulted");
  assert.doesNotMatch(
    script,
    /\[ "\$was_running" =/,
    "no undefaulted `$was_running` comparison anywhere",
  );
});
