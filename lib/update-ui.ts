/**
 * What the update banner says, and when.
 *
 * `components/UpdateBanner.tsx` used to hold four independent booleans (`applying`, `stalled`,
 * `error`, `activeTasks`) and derive its wording inline from all of them. That is what produced
 * the two bugs this module exists to fix: a refused update (409 — a task is still running, which
 * on this platform includes a task merely *waiting at a gate*) only relabelled the same button
 * from "Update now" to "Update anyway" and printed the reason as small text beside other copy,
 * so the first click read as "nothing happened"; and a genuine failure was never reported at
 * all, because the banner had no way to learn about one and could only poll to a fixed six-minute
 * timeout.
 *
 * Everything here is pure, so `lib/update-ui.test.ts` can cover the parts that were previously
 * only visible by reproducing a failed update by hand:
 *
 * - **which state an update record implies** (`phaseForRun`, `phaseOnLoad`), including the two
 *   places `stale` must and must not be honoured;
 * - **whether a record describes *this* attempt** (`isFreshRun`) — the check that stops a
 *   previous failure being reported as the outcome of the click just made;
 * - **the copy itself**, built as whole template strings. Two reasons for that: singular/plural
 *   ("1 task is" vs "3 tasks are") is a real correctness bug in a sentence a user reads at the
 *   moment they're being told to make a decision, and interleaving `{expr}` with prose in JSX
 *   silently drops the space between them (see `.fe/notes.md` — it shipped once as
 *   "90 taskspredates").
 *
 * The type is imported **type-only** on purpose: `lib/update-run.ts` reaches for `node:fs`, and
 * this module is pulled into a client component. `import type` is erased at compile time, so
 * nothing here can drag the reader into the browser bundle.
 */
import type { UpdateRun } from "./update-run";

/**
 * The fields of an update record the UI actually reads, as they arrive over the wire from
 * `GET /api/updates`. A `Pick` rather than a restatement, so the two can't drift — and so a
 * test fixture only has to name what it's testing.
 */
export type UpdateRunView = Pick<
  UpdateRun,
  "state" | "target" | "message" | "logPath" | "logTail" | "stale" | "startedAt"
>;

/** What an update record means for the banner, or `null` for "this says nothing to show". */
export type RunPhase = "failure" | "running" | "uptodate" | null;

export type BannerCopy = {
  /** The first thing read — a headline, not a sentence fragment buried in other copy. */
  headline: string;
  /** Why it matters and what to do about it. */
  body: string;
};

/** Shown when the apply request itself never got off the ground. */
export const NO_ANSWER_ERROR = "The server didn't answer.";

/**
 * How often an idle banner asks again, and how soon it may ask after coming back into view.
 *
 * The banner used to fetch `/api/updates` exactly **once**, on mount — and it mounts in
 * `app/(app)/layout.tsx`, a persistent App Router layout that client-side navigation never
 * remounts. So in the Mac app, a window left open for days never checked again, and several
 * releases came and went with nothing on screen. That is the bug this pair of constants fixes.
 *
 * `RECHECK_MS` matches the server's own cache TTL: asking more often than that only ever gets
 * the same memoized answer back, and the request that *would* reach GitHub is the one this is
 * timed to catch.
 */
export const RECHECK_MS = 30 * 60 * 1000;
/**
 * A window that has been hidden for a while should check as soon as someone looks at it, rather
 * than waiting out the rest of an interval that ticked by unseen. Floored so that flicking
 * between windows, or a tab-switch storm, can't turn focus into a request loop — and the server
 * has its own floor underneath this one either way.
 */
export const VISIBLE_RECHECK_MS = 2 * 60 * 1000;

/**
 * Should the banner ask again?
 *
 * `lastCheckedAt` is the server's `checkedAt`, not the time of our last *request*: what matters is
 * how old the answer is, and a reply served from the server's cache carries the original stamp.
 * `null` means we have no answer at all yet.
 *
 * A negative age (a clock that stepped back, or a server clock ahead of the browser's) reads as
 * "recent" and holds, which is the direction that can't produce a request loop.
 */
export function shouldRecheck({
  lastCheckedAt,
  now,
  becameVisible = false,
}: {
  lastCheckedAt: number | null;
  now: number;
  /** True when this is prompted by the window being looked at again, not by the interval. */
  becameVisible?: boolean;
}): boolean {
  if (lastCheckedAt === null) return true;
  const age = now - lastCheckedAt;
  if (age < 0) return false;
  return age >= (becameVisible ? VISIBLE_RECHECK_MS : RECHECK_MS);
}

/**
 * "just now" / "6 minutes ago" — how old the answer on screen is.
 *
 * This lives here rather than in `VersionSettings` because it is the only thing that makes a
 * *cached* reply to "Check now" readable as "yes, this really is current" instead of a button
 * that did nothing — and because `pnpm test` cannot reach `components/`, so its rounding
 * boundaries would otherwise ship unverified.
 *
 * A negative age (the server's clock ahead of the browser's) reads as "just now" rather than
 * "in 3 minutes": both stamps come from different clocks, and a future time is never the useful
 * thing to tell someone.
 */
export function checkedAgo(checkedAt: number, now: number): string {
  // A non-finite stamp would make every comparison below false and render "NaN days ago".
  // `checkedAt` comes off a JSON response, so "it's always Date.now()" is a property of today's
  // server, not of the type.
  if (!Number.isFinite(checkedAt) || !Number.isFinite(now)) return "just now";
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * What the Settings card says about where this install stands.
 *
 * Separate from the banner's copy because it answers a different question. The banner only ever
 * appears when there is something to *do*; this card is opened by someone asking "am I current?",
 * so it has to have an answer for every state — including the quiet ones the banner deliberately
 * renders as nothing (offline, rate-limited, mid-publish, a git checkout).
 */
export type VersionSummary = {
  headline: string;
  body: string;
  tone: "ok" | "info" | "warn" | "muted";
};

export function versionSummary({
  current,
  latest,
  updateAvailable,
  packaged,
  unavailable,
}: {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  packaged: boolean;
  unavailable?: string;
}): VersionSummary {
  if (!packaged) {
    return {
      tone: "muted",
      headline: `Running from a checkout (${current})`,
      body: "Updates are applied with git pull, not from here — there's no release for the launcher to install.",
    };
  }
  if (updateAvailable && latest) {
    return {
      tone: "info",
      headline: `Version ${latest} is available`,
      body: `You're on ${current}. The bar at the top of the window installs it.`,
    };
  }
  switch (unavailable) {
    case "offline":
      return {
        tone: "warn",
        headline: "Couldn't reach GitHub",
        body: `You're on ${current}. Nothing is wrong with the app — the release check just couldn't get an answer.`,
      };
    case "rate-limited":
      return {
        tone: "warn",
        headline: "GitHub is rate-limiting the check",
        body: `You're on ${current}. The unauthenticated limit is 60 requests an hour per address; this resets within the hour.`,
      };
    case "publishing":
      // The one state worth explaining rather than hiding: a user who saw the release announced
      // and finds nothing offered here would otherwise conclude the check is broken.
      return {
        tone: "info",
        headline: latest
          ? `Version ${latest} is still publishing`
          : "A newer version is still publishing",
        body: `You're on ${current}. Its install files are still uploading — this usually takes a couple of minutes, and it'll be offered as soon as they're there.`,
      };
    case "no-releases":
      return {
        tone: "muted",
        headline: `Version ${current}`,
        body: "No published releases were found to compare against.",
      };
    default:
      return {
        tone: "ok",
        headline: `Version ${current} is up to date`,
        body: latest
          ? `${latest} is the newest release.`
          : "This is the newest release.",
      };
  }
}

/**
 * Classify an update record while an attempt is being watched.
 *
 * `stale` (the attempt targeted a version that is already installed) is honoured for the failure
 * states and **not** for `up-to-date`: an up-to-date attempt targets the version it found
 * installed, so `stale` is true by definition there and checking it would discard the very
 * record that explains why nothing happened.
 *
 * `succeeded` deliberately says nothing. A successful update replaces the server, so the
 * evidence the banner acts on is the *version* it gets back — not a record written by the
 * attempt itself.
 */
export function phaseForRun(run: UpdateRunView | null | undefined): RunPhase {
  if (!run) return null;
  switch (run.state) {
    case "running":
      return "running";
    case "failed":
    case "crashed":
      return run.stale ? null : "failure";
    case "up-to-date":
      return "uptodate";
    default:
      return null;
  }
}

/**
 * Classify a record found on **page load** rather than during a watched attempt.
 *
 * Narrower than `phaseForRun` by one state: an `up-to-date` record can be days old, and the
 * release check on this same response is authoritative about what's available *now*. Announcing
 * "you're already on the latest" next to a live "0.7.0 is available" would just be the banner
 * contradicting itself. A failure is worth surfacing precisely because the run that produced it
 * is over and nothing else will ever mention it.
 */
export function phaseOnLoad(run: UpdateRunView | null | undefined): RunPhase {
  const phase = phaseForRun(run);
  return phase === "failure" || phase === "running" ? phase : null;
}

/**
 * Is this record *this* attempt's, or the one that was already lying there?
 *
 * Both writers stamp a fresh `startedAt` — the route before it answers, then the script on its
 * first line — so an inequality is enough, and it needs no clock the browser has to trust.
 * Without it, clicking "Update now" on an install whose *previous* attempt failed against the
 * same version would report that old failure instantly as the outcome of the new click.
 *
 * Two unknown stamps compare as unchanged, which keeps the poll waiting rather than blaming a
 * new attempt for an old failure. That's the safe direction: waiting ends in a message about
 * waiting, while guessing wrong invents a failure that never happened.
 */
export function isFreshRun(
  run: UpdateRunView | null | undefined,
  baseline: UpdateRunView | null | undefined,
): boolean {
  if (!run) return false;
  return (run.startedAt ?? null) !== (baseline?.startedAt ?? null);
}

/**
 * How many tasks the server said are in flight — or `null` when it didn't say anything usable.
 *
 * It's a number off the wire that lands directly in a sentence, so a non-integer would render
 * as "1.5 tasks are still running" and a missing one as "undefined". Neither is a count.
 */
export function taskCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/**
 * The update was refused because work is in flight.
 *
 * This is the state the whole task is about, so the count leads and the consequence is spelled
 * out: "still running" alone doesn't tell anyone that pressing on ends those runs. The server's
 * own 409 sentence is the fallback for a response with no usable count — it stays the wording a
 * non-UI caller sees either way.
 */
export function blockedCopy(
  activeTasks: number | null,
  serverMessage: string | null = null,
): BannerCopy {
  if (activeTasks === null) {
    return {
      headline: "Work is still in flight",
      body:
        serverMessage ??
        "Updating restarts the server, which ends any task that is still running.",
    };
  }
  const one = activeTasks === 1;
  return {
    headline: `${activeTasks} task${one ? " is" : "s are"} still running`,
    body: `Updating restarts the server, which ends ${one ? "it" : "them"} mid-run and loses ${one ? "its" : "their"} progress. Wait for ${one ? "it" : "them"} to finish, or update anyway.`,
  };
}

/**
 * Start a shell message with a capital, so it reads as the sentence it's rendered as.
 *
 * `die`'s messages are written to be printed after `error: `, so they start lowercase — and
 * under a headline, "build failed — the existing install is untouched." looks like a typo rather
 * than a quotation. The one thing that must *not* be touched is a message beginning with a URL:
 * `die "$URL never answered…"` would otherwise render as "Http://localhost:7373". Everything
 * else in that script opens with an ordinary English word.
 */
export function sentenceCase(message: string): string {
  if (/^[a-z]+:\/\//.test(message)) return message;
  return message.replace(/^[a-z]/, (c) => c.toUpperCase());
}

/** The reason to fall back on when a stopped attempt didn't record one. */
const NO_REASON: Record<string, string> = {
  failed: "It stopped without recording a reason.",
  crashed: "The update process stopped before it finished.",
};

export type FailureCopy = BannerCopy & {
  /** The end of the attempt's log, when there is one to show. */
  logTail: string | null;
  logPath: string | null;
};

/**
 * An update that ran and didn't finish.
 *
 * The body leads with the attempt's own words (`die`'s message — "build failed — the existing
 * install is untouched.", "checksum mismatch for … — refusing to install."), unedited: it names
 * the step that stopped, which is the entire difference between this and the generic timeout it
 * replaces. Capitalising or rewrapping it would only put this component in the business of
 * paraphrasing a shell script.
 *
 * Then the version, because the first question after a failed update is what you're left
 * running — and it's answerable with certainty: this reply came from the server that answered,
 * so `current` is what's installed right now.
 */
export function failureCopy(
  run: UpdateRunView,
  currentVersion: string,
): FailureCopy {
  const message = run.message?.trim();
  const reason = message
    ? sentenceCase(message)
    : NO_REASON[run.state] || NO_REASON.failed;
  return {
    headline: run.target
      ? `The update to ${run.target} didn't finish`
      : "The update didn't finish",
    body: `${reason} You're still on ${currentVersion}.`,
    logTail: run.logTail?.trim() ? run.logTail.trim() : null,
    logPath: run.logPath || null,
  };
}

/**
 * The update never started — a refused request, or one that didn't arrive.
 *
 * Distinct from `failureCopy` because nothing has run: there is no log to read and no step to
 * name, so promising either would send someone looking for a file that was never written.
 */
export function startErrorCopy(message: string | null | undefined): BannerCopy {
  return {
    headline: "Couldn't start the update",
    body: message?.trim() || "Something went wrong before the update began.",
  };
}

/** The attempt concluded that there was nothing newer to install after all. */
export function uptodateCopy(currentVersion: string): BannerCopy {
  return {
    headline: `You're already on the latest version (${currentVersion})`,
    body: "Nothing newer than this has been published — the notice was out of date.",
  };
}

/**
 * The last resort: the wait ran out with no outcome recorded.
 *
 * Split in two, which is the point of it. `answering` — did the *most recent* poll get a reply —
 * separates "this is slow" from "the server went away and hasn't come back", and only the second
 * one is worth telling someone to quit and reopen the app for. Reopening genuinely resolves it:
 * `control-center start` applies a pending update on the way up. Offering that advice for a
 * build that is merely slow, which is what the old fixed timeout did, interrupts a working
 * update instead.
 *
 * The log's path isn't in here: it's rendered as a path, in mono, beside the same disclosure the
 * failure state uses, rather than as a wall of characters mid-sentence.
 */
export function stalledCopy(answering: boolean): BannerCopy {
  return answering
    ? {
        headline: "The update is taking longer than expected",
        body: "It has been going for several minutes without reporting an outcome. It may still finish on its own.",
      }
    : {
        headline: "The server hasn't come back",
        body: "The update stopped this server and nothing has answered since. Quit Agent Control Center and open it again — it picks the update up on launch.",
      };
}
