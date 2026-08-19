/**
 * What an update attempt left behind.
 *
 * `POST /api/updates/apply` hands the work to a **detached** `control-center update` — it has
 * to, since applying an update replaces the files of the process that would be applying it —
 * and that child used to be spawned with `stdio: "ignore"`. Every line of the attempt went
 * nowhere: the download, the checksum, `pnpm install`, `next build`, and every `die` message
 * saying which of them failed. The dashboard was left inferring the outcome from a version
 * number that never changed, and gave up after six minutes with "quit and open it again".
 *
 * An attempt now leaves two files under `~/.control-center`, both written by
 * `infra/release/control-center.sh` (the first record by the route — see `markUpdateStarted`):
 *
 *     logs/update.log     the whole run, truncated per attempt
 *     run/update.status   one `key=value` per line — state, pid, from, target,
 *                         startedAt, endedAt, message
 *
 * This module is the reader, and two rules shape it:
 *
 * - **The status file is untrusted input.** Another process writes it, in shell, and the route
 *   that serves it has no auth (loopback-only, like the rest — see CLAUDE.md). So the read is
 *   size-capped, every value is stripped and clipped, and an unrecognised `state` makes the
 *   whole record unusable rather than something invented. The log that gets tailed is always
 *   the canonical path derived here, **never** a path read out of the file: that would turn a
 *   writable `run/` into an arbitrary-file-read primitive on an unauthenticated route.
 * - **`state=running` is a claim, not a fact.** A run killed by `set -e`, by `kill -9`, or by a
 *   reboot leaves `running` behind forever. A record claiming `running` whose pid is gone
 *   therefore reads as `crashed` — which is what lets the UI say "it stopped" the moment it
 *   stopped, instead of polling to a fixed timeout.
 */
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { isInside, isSameSoleFile } from "./safe-read";
import { compareVersions } from "./updates";

/** The variables that decide where the record lives. Narrower than `NodeJS.ProcessEnv` on
 *  purpose: a caller — and a spec — should be able to hand over the two that matter. */
export type UpdateEnv = {
  CC_HOME?: string;
  PLATFORM_DATA_DIR?: string;
  /** So a whole `process.env` is still assignable — it declares more than these two. */
  [key: string]: string | undefined;
};

/** States the shell writes, plus the one only a reader can tell (see the header). */
export type UpdateRunState =
  | "running"
  | "succeeded"
  | "failed"
  | "up-to-date"
  | "crashed";

export type UpdateRun = {
  state: UpdateRunState;
  /** Version installed when the attempt started. */
  from: string | null;
  /** Version it was updating to — null when it stopped before finding out. */
  target: string | null;
  /** Unix ms, so it survives JSON. */
  startedAt: number | null;
  /** Unix ms; null while it's still running. */
  endedAt: number | null;
  /** One line naming the step that stopped it. Only failures record one. */
  message: string | null;
  /** Where the full output went, for a human who wants the rest of it. */
  logPath: string;
  /** The end of that log — failures only (see `readUpdateRun`). */
  logTail: string | null;
  /**
   * Nothing here is pending any more: the attempt targeted a version that is already
   * installed. A failed attempt that a later `control-center start` quietly completed would
   * otherwise keep reporting a failure forever.
   */
  stale: boolean;
};

/** Where the two files sit under the install root, as paths to be contained (see
 *  `readContained` — the *relative* form is what lets an escape be detected at all). */
const STATUS_REL = "run/update.status";
const LOG_REL = "logs/update.log";

/** Ours are ~200 bytes. Anything remotely this big is not a file we wrote. */
const STATUS_MAX_BYTES = 8 * 1024;
const LOG_TAIL_BYTES = 8 * 1024;
const LOG_TAIL_LINES = 12;
const LOG_TAIL_CHARS = 2_000;
const MAX_VERSION_CHARS = 40;
const MAX_MESSAGE_CHARS = 400;
/**
 * How long a record may claim to be `running` before a reader stops believing it. Generous on
 * purpose: download + `pnpm install` + `next build` is minutes on a slow machine, and being
 * wrong in *this* direction lets the apply route start a second update beside a live one, which
 * races its `mv` on `app/`. Being wrong the other way only delays a retry.
 */
const RUNNING_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * …and how far in the *future* a start time may sit. A record dated next century defeated the
 * ceiling entirely — `now - startedAt` goes negative, which is under any upper bound, so the
 * re-audit wedged the apply route permanently again with one file write. It can't be a flat
 * `age >= 0` either: both stamps come from the same clock, but that clock can step backwards
 * mid-update, and disbelieving a live run is the direction that starts a second one. A few
 * minutes covers a correction; it doesn't extend how long a forged record can hold, since any
 * forgery can already claim to have started *now*.
 */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The install root the `control-center` CLI owns (`app/`, `data/`, `logs/`, `run/`, `.env`).
 *
 * `CC_HOME` is authoritative — the CLI exports it to the server it spawns. Failing that, an
 * install always points `PLATFORM_DATA_DIR` at `$CC_HOME/data`, which is what makes a server
 * started by an older CLI (one that predates this bookkeeping) still find the right place.
 */
export function ccHome(env: UpdateEnv = process.env): string {
  const explicit = env.CC_HOME?.trim();
  if (explicit) return resolve(explicit);
  const data = env.PLATFORM_DATA_DIR?.trim();
  if (data) return dirname(resolve(data));
  return resolve(homedir(), ".control-center");
}

/** The two files an attempt writes. */
export function updateRunPaths(env: UpdateEnv = process.env): {
  status: string;
  log: string;
} {
  const home = ccHome(env);
  return {
    status: resolve(home, "run/update.status"),
    log: resolve(home, "logs/update.log"),
  };
}

/**
 * Read one of our own two files, under the root that must contain it.
 *
 * This answers an unauthenticated request with the contents of a file in the user's home, so it
 * gets the full treatment from `lib/safe-read.ts` — and it needs all of it. The first version
 * had `O_NOFOLLOW` alone, and the security audit walked straight through it twice:
 *
 * - `O_NOFOLLOW` only refuses a symlink as the **final** component, so pointing `logs` itself
 *   at another directory redirected the whole read (`logTail` returned a planted file's
 *   contents). Answered by resolving the path after opening and requiring it to land inside
 *   `root` — and by comparing **inodes**, since re-checking the path alone loses the race where
 *   the directory is swapped back.
 * - a **hard link** at `logs/update.log` has no target to resolve, so realpath reports it as
 *   living exactly where it appears; `~/.control-center/.env` (which holds
 *   `SECRETS_MASTER_KEY`) is on the same filesystem. Answered by `nlink === 1`, which is what
 *   `isSameSoleFile` demands of both sides.
 *
 * The literal path is what gets opened, not its realpath, so `O_NOFOLLOW` still refuses a
 * symlink standing in for the file itself **even when it stays inside the root** — unlike
 * `readBytesInside`, which allows that. It has to be stricter: inside this particular root are
 * `.env` and the token vault, and nothing legitimate ever links to them from `logs/`.
 *
 * `O_NONBLOCK` is not optional either: `open` on a FIFO waits for a writer, and it does so
 * before `fstat` can classify it, so a named pipe here would hang the request forever.
 *
 * What this still doesn't close, knowingly: an attacker who *renames* the inode we opened into
 * the contained path during the window passes both checks, because rename moves the only name
 * rather than adding a second one, so `nlink` stays 1. Note the shape — a hard-link test does
 * not cover it. Closing it needs the parent directory held as a descriptor (`openat`/`O_PATH`),
 * which Node doesn't expose; `.swe/notes.md` records the same residual for `readBytesInside`.
 *
 * `tail` reads the last `maxBytes` instead of refusing an oversized file: an update log is a
 * `next build` transcript, and its end is the interesting part.
 */
function readContained(
  root: string,
  rel: string,
  maxBytes: number,
  { tail = false }: { tail?: boolean } = {},
): string | null {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null; // no install here at all
  }
  const path = resolve(realRoot, rel);

  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    if (!tail && st.size > maxBytes) return null;
    // Everything above was about the handle; this is about where that handle *lives*. Resolved
    // after the open, so a directory swapped mid-flight is caught: either the symlink is still
    // there and this lands outside the root, or it has been put back and the inode at the
    // contained path is no longer the one we are holding.
    const real = realpathSync(path);
    if (!isInside(real, realRoot)) return null;
    if (!isSameSoleFile(st, statSync(real))) return null;
    const start = tail ? Math.max(0, st.size - maxBytes) : 0;
    const length = Math.min(st.size, maxBytes);
    if (length === 0) return null;
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buf, read, length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    return buf.subarray(0, read).toString("utf8");
  } catch {
    return null; // missing, a symlink, a pipe, no permission — all "no record"
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Colour codes and control characters, out. Tools that think they're on a terminal emit
 *  escape sequences, and this text is rendered in the app. */
function sanitize(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

/** A single-line field, or null when it holds nothing usable. */
function field(raw: string | undefined, maxChars: number): string | null {
  const value = sanitize(raw ?? "")
    .replace(/[\r\n]/g, " ")
    // The shell clips a long message with `cut`, which counts characters or bytes depending on
    // whose `cut` it is — so a multi-byte character can be cut in half and decode to U+FFFD.
    // Drop that trailing debris rather than rendering "…the existing install is untouche�".
    .replace(/�+$/, "")
    .trim()
    .slice(0, maxChars);
  return value === "" ? null : value;
}

/** Unix seconds as written by `date +%s` → ms. */
function stamp(raw: string | undefined): number | null {
  if (!raw) return null;
  const seconds = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * `key=value` lines into a map. **First occurrence wins**: a value can't contain a newline (the
 * writer strips them), so a second `state=` line means the file was tampered with rather than
 * updated, and the first one is the only one either writer could have produced.
 */
export function parseStatusFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(line);
    if (match && !(match[1] in out)) out[match[1]] = match[2];
  }
  return out;
}

/** Only the states the shell writes. Anything else discards the record. */
function writtenState(
  value: string | undefined,
): Exclude<UpdateRunState, "crashed"> | null {
  switch (value?.trim()) {
    case "running":
    case "succeeded":
    case "failed":
    case "up-to-date":
      return value.trim() as Exclude<UpdateRunState, "crashed">;
    default:
      return null;
  }
}

/** Is that process still there? `EPERM` means it exists and isn't ours — still alive. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The tail of the update log, tidied into the last few non-blank lines. */
function logTail(root: string): string | null {
  const raw = readContained(root, LOG_REL, LOG_TAIL_BYTES, { tail: true });
  if (raw === null) return null;
  const lines = sanitize(raw)
    // \r as a line break too: progress output overwrites its line rather than ending it, so
    // splitting on it keeps the final state of a spinner instead of one enormous line.
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  if (!lines.length) return null;
  return lines.slice(-LOG_TAIL_LINES).join("\n").slice(-LOG_TAIL_CHARS);
}

/**
 * The last update attempt, or null when there hasn't been one (or the record is unusable).
 *
 * `logTail` is attached only to the states where it diagnoses something. During a healthy run
 * it would be build output, growing, on a route the banner polls every couple of seconds —
 * and on a route with no auth in front of it.
 */
export function readUpdateRun({
  env = process.env,
  currentVersion = null,
  pidAlive = processAlive,
  now = Date.now(),
}: {
  env?: UpdateEnv;
  /** The version this process is running, for `stale`. */
  currentVersion?: string | null;
  pidAlive?: (pid: number) => boolean;
  now?: number;
} = {}): UpdateRun | null {
  const home = ccHome(env);
  const text = readContained(home, STATUS_REL, STATUS_MAX_BYTES);
  if (text === null) return null;

  const record = parseStatusFile(text);
  const written = writtenState(record.state);
  if (!written) return null;

  const pid = Number.parseInt(record.pid ?? "", 10);
  const startedAt = stamp(record.startedAt);
  // Is this claim of "running" believable? Three ways it isn't:
  // - the pid is gone: the ordinary crash case (a `set -e` death, a `kill -9`, a reboot);
  // - there is no readable pid: both writers always record one, so this is a file nobody here
  //   wrote;
  // - its start time isn't one an update could have. Pid numbers get recycled, so a record left
  //   behind by a reboot can name a pid that now belongs to something else and stay "running"
  //   forever — and while it does, the apply route refuses every retry, which is precisely the
  //   "the button does nothing" bug this work exists to fix. Both ends of the window are
  //   load-bearing: the audit wedged it with `pid=1` and an ancient stamp, then wedged it again
  //   with `pid=1` and a stamp a century in the *future*, which slipped under an upper bound
  //   alone.
  // All three read as `crashed`, which lets a retry through. That direction is deliberate: a
  // wrongly-believed record blocks updates, and only the window risks the opposite, which is
  // why it is an hour wide rather than minutes.
  const age = startedAt === null ? null : now - startedAt;
  const believable =
    Number.isSafeInteger(pid) &&
    pid > 0 &&
    pidAlive(pid) &&
    age !== null &&
    age > -CLOCK_TOLERANCE_MS &&
    age < RUNNING_MAX_AGE_MS;
  const state: UpdateRunState =
    written === "running" && !believable ? "crashed" : written;

  const target = field(record.target, MAX_VERSION_CHARS);
  return {
    state,
    from: field(record.from, MAX_VERSION_CHARS),
    target,
    startedAt,
    endedAt: stamp(record.endedAt),
    message: field(record.message, MAX_MESSAGE_CHARS),
    logPath: updateRunPaths(env).log,
    logTail: state === "failed" || state === "crashed" ? logTail(home) : null,
    stale:
      target !== null &&
      currentVersion !== null &&
      compareVersions(target, currentVersion) <= 0,
  };
}

/**
 * Start this attempt's log, truncating the previous one, and return a handle for the child's
 * stdout and stderr. The caller closes the fd once the child has it.
 *
 * The header is not decoration: it is the only proof the route got this far, for the case where
 * the child never runs at all.
 */
export function openAttemptLog(env: UpdateEnv = process.env): {
  path: string;
  fd: number;
} {
  const { log } = updateRunPaths(env);
  mkdirSync(dirname(log), { recursive: true });
  writeFileSync(
    log,
    `=== control-center update started ${new Date().toISOString()} ===\n`,
    { mode: 0o600 },
  );
  // Append mode, so the shell's own writes and ours can't land on top of each other.
  const fd = openSync(log, "a");
  // `mode` above only applies to a file being *created*, and a manual `control-center update`
  // creates this one via `tee` under the caller's umask — so an existing log keeps whatever bits
  // it had. Narrow it on the handle we already hold rather than by path: it carries a
  // transcript of the update, and the tail of it is served over HTTP.
  try {
    fchmodSync(fd, 0o600);
  } catch {
    /* a log we can't chmod is still a log */
  }
  return { path: log, fd };
}

/**
 * Record that an attempt has just been spawned, before it can say so itself.
 *
 * Without this the file still holds the *previous* attempt's outcome for the second or two it
 * takes the script to start — long enough for a poller to read "failed" from last week and
 * report it as this click's result. `control-center.sh` overwrites this with more detail
 * (`record_update`), in the same format.
 */
export function markUpdateStarted({
  pid,
  from,
  env = process.env,
  now = Date.now(),
}: {
  pid: number;
  from: string;
  env?: UpdateEnv;
  now?: number;
}): void {
  const { status } = updateRunPaths(env);
  mkdirSync(dirname(status), { recursive: true });
  const body =
    [
      "state=running",
      `pid=${Math.trunc(pid)}`,
      `from=${field(from, MAX_VERSION_CHARS) ?? ""}`,
      "target=",
      `startedAt=${Math.floor(now / 1000)}`,
      "endedAt=",
      "message=",
    ].join("\n") + "\n";
  // Temp-then-rename, like the shell writer: a reader polling this can never see half a file.
  const tmp = `${status}.${process.pid}`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, status);
}
