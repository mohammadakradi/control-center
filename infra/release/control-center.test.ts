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
 *   - `newer`       → `v99.0.0` for the release check but fails the tarball download, so the
 *                     `start` path actually enters `apply_update` (and thus `check_and_update`'s
 *                     own acquire/release) before dying.
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
  // Newer release exists, but the tarball download fails (curl exit 22) — so `apply_update`
  // is entered and then dies, exercising the `start`/`check_and_update` acquire+release path.
  newer:
    '#!/bin/sh\ncase "$*" in\n  *api.github.com*) printf \'%s\' \'{"tag_name":"v99.0.0"}\' ;;\n  *) exit 22 ;;\nesac\n',
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
  // `start` doesn't tee, so the die message is on stderr.
  assert.match(res.stderr, /download failed/);
  assert.ok(
    !existsSync(lockDir(home)),
    "a failed apply on the start path must release the lock",
  );
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
