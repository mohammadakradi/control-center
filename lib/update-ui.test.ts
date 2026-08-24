/**
 * Unit tests for the update banner's state and copy rules. Pure functions, no DOM — the point is
 * to pin the things that were previously only observable by breaking a real update on a real
 * install: which record makes the banner report a failure, which record it must ignore, and the
 * sentences it says while asking someone to make a decision.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  blockedCopy,
  checkedAgo,
  failureCopy,
  isFreshRun,
  phaseForRun,
  phaseOnLoad,
  RECHECK_MS,
  sentenceCase,
  shouldRecheck,
  stalledCopy,
  startErrorCopy,
  taskCount,
  uptodateCopy,
  versionSummary,
  VISIBLE_RECHECK_MS,
  type UpdateRunView,
} from "./update-ui";

const run = (over: Partial<UpdateRunView> = {}): UpdateRunView => ({
  state: "running",
  target: "0.7.0",
  message: null,
  logPath: "/home/u/.control-center/logs/update.log",
  logTail: null,
  stale: false,
  startedAt: 1_000,
  ...over,
});

test("phaseForRun maps every state the reader can produce", () => {
  assert.equal(phaseForRun(run({ state: "running" })), "running");
  assert.equal(phaseForRun(run({ state: "failed" })), "failure");
  assert.equal(phaseForRun(run({ state: "crashed" })), "failure");
  assert.equal(phaseForRun(run({ state: "up-to-date" })), "uptodate");
  // A successful attempt replaces the server, so the version coming back is the evidence —
  // not a record the attempt wrote about itself.
  assert.equal(phaseForRun(run({ state: "succeeded" })), null);
  assert.equal(phaseForRun(null), null);
  assert.equal(phaseForRun(undefined), null);
});

test("a stale failure is dropped, but a stale up-to-date is not", () => {
  // Stale = the attempt targeted a version that is already installed, so a failure against it
  // is moot: something completed it since.
  assert.equal(phaseForRun(run({ state: "failed", stale: true })), null);
  assert.equal(phaseForRun(run({ state: "crashed", stale: true })), null);
  // `up-to-date` targets the version it found installed, so `stale` is true by definition
  // there. Honouring it would discard the one record that explains why nothing happened.
  assert.equal(
    phaseForRun(run({ state: "up-to-date", stale: true })),
    "uptodate",
  );
});

test("page load adopts a failure or an in-flight run, and nothing else", () => {
  assert.equal(phaseOnLoad(run({ state: "failed" })), "failure");
  assert.equal(phaseOnLoad(run({ state: "running" })), "running");
  // Could be days old, and the release check on the same response is authoritative about now.
  assert.equal(phaseOnLoad(run({ state: "up-to-date", stale: true })), null);
  assert.equal(phaseOnLoad(run({ state: "succeeded" })), null);
  assert.equal(phaseOnLoad(null), null);
});

test("isFreshRun tells this attempt's record from the one already lying there", () => {
  const before = run({ state: "failed", startedAt: 1_000 });
  // The same record the click started from says nothing about the click.
  assert.equal(isFreshRun(before, before), false);
  assert.equal(isFreshRun(run({ startedAt: 2_000 }), before), true);
  // Nothing was there before: anything is news.
  assert.equal(isFreshRun(run({ startedAt: 2_000 }), null), true);
  assert.equal(isFreshRun(null, before), false);
});

test("isFreshRun keeps waiting when neither stamp is known", () => {
  // Both unknown compares as unchanged on purpose: waiting ends in a message about waiting,
  // while guessing wrong invents a failure that never happened.
  assert.equal(
    isFreshRun(
      run({ state: "failed", startedAt: null }),
      run({ startedAt: null }),
    ),
    false,
  );
  assert.equal(isFreshRun(run({ startedAt: null }), null), false);
  assert.equal(
    isFreshRun(run({ startedAt: 5 }), run({ startedAt: null })),
    true,
  );
});

test("taskCount only accepts a real count", () => {
  assert.equal(taskCount(3), 3);
  assert.equal(taskCount(1), 1);
  assert.equal(taskCount(0), null);
  assert.equal(taskCount(-2), null);
  assert.equal(taskCount(1.5), null);
  assert.equal(taskCount(Number.NaN), null);
  assert.equal(taskCount("2"), null);
  assert.equal(taskCount(undefined), null);
});

test("blockedCopy agrees with itself about one task or several", () => {
  const one = blockedCopy(1);
  assert.equal(one.headline, "1 task is still running");
  assert.match(one.body, /ends it mid-run and loses its progress/);
  assert.match(one.body, /Wait for it to finish/);

  const many = blockedCopy(3);
  assert.equal(many.headline, "3 tasks are still running");
  assert.match(many.body, /ends them mid-run and loses their progress/);
  assert.match(many.body, /Wait for them to finish/);
});

test("blockedCopy never renders a sentence with a word missing a space", () => {
  // The failure mode this shape exists to prevent: interleaving {expr} with prose in JSX drops
  // the space between them, which shipped once as "90 taskspredates".
  for (const n of [1, 2, 12]) {
    const { headline, body } = blockedCopy(n);
    for (const text of [headline, body]) {
      assert.doesNotMatch(text, /[a-z][A-Z]|\d[a-z]{2}/, text);
      assert.doesNotMatch(text, /\s\s|^\s|\s$/, text);
    }
  }
});

test("blockedCopy falls back to the server's sentence with no usable count", () => {
  const copy = blockedCopy(
    null,
    "2 tasks are still running. Updating restarts the server.",
  );
  assert.equal(copy.headline, "Work is still in flight");
  assert.equal(
    copy.body,
    "2 tasks are still running. Updating restarts the server.",
  );
  // …and still says something when the server didn't either.
  assert.match(blockedCopy(null).body, /ends any task that is still running/);
});

test("sentenceCase opens a shell message as a sentence, but never a URL", () => {
  // `die`'s messages are written to follow "error: ", so they start lowercase.
  assert.equal(
    sentenceCase("build failed — the existing install is untouched."),
    "Build failed — the existing install is untouched.",
  );
  assert.equal(
    sentenceCase("checksum mismatch for x"),
    "Checksum mismatch for x",
  );
  // …except this one, which really does start with a URL: `die "$URL never answered…"`.
  assert.equal(
    sentenceCase("http://localhost:7373 never answered. Logs: /logs/web.log"),
    "http://localhost:7373 never answered. Logs: /logs/web.log",
  );
  // Already a sentence, or not a letter at all: left exactly as it is.
  assert.equal(
    sentenceCase("Node.js 22+ is required"),
    "Node.js 22+ is required",
  );
  assert.equal(
    sentenceCase("/tmp/x is not writable"),
    "/tmp/x is not writable",
  );
  assert.equal(sentenceCase(""), "");
});

test("failureCopy leads with the attempt's own words, unedited", () => {
  const copy = failureCopy(
    run({
      state: "failed",
      message: "build failed — the existing install is untouched.",
      logTail: "  next build\nFailed to compile.\n",
    }),
    "0.6.0",
  );
  assert.equal(copy.headline, "The update to 0.7.0 didn't finish");
  // The step that stopped, in the script's own words — only the opening letter is touched.
  assert.equal(
    copy.body,
    "Build failed — the existing install is untouched. You're still on 0.6.0.",
  );
  assert.equal(copy.logTail, "next build\nFailed to compile.");
  assert.equal(copy.logPath, "/home/u/.control-center/logs/update.log");
});

test("failureCopy still says something useful with no message, target or log", () => {
  const crashed = failureCopy(
    run({ state: "crashed", message: null, target: null, logTail: "   " }),
    "0.6.0",
  );
  assert.equal(crashed.headline, "The update didn't finish");
  assert.equal(
    crashed.body,
    "The update process stopped before it finished. You're still on 0.6.0.",
  );
  // Whitespace is not a log tail — an empty panel would look like the log was lost.
  assert.equal(crashed.logTail, null);

  const failed = failureCopy(run({ state: "failed", message: "  " }), "0.6.0");
  assert.match(failed.body, /^It stopped without recording a reason\./);
});

test("startErrorCopy promises no log, because nothing ran", () => {
  const refused = startErrorCopy(
    "This is a development checkout, not an installed app.",
  );
  assert.equal(refused.headline, "Couldn't start the update");
  assert.equal(
    refused.body,
    "This is a development checkout, not an installed app.",
  );
  assert.match(startErrorCopy(null).body, /before the update began/);
  assert.match(startErrorCopy("   ").body, /before the update began/);
});

test("uptodateCopy names the version and admits the notice was wrong", () => {
  const copy = uptodateCopy("0.6.0");
  assert.equal(copy.headline, "You're already on the latest version (0.6.0)");
  assert.match(copy.body, /out of date/);
});

test("stalledCopy only says quit-and-reopen when the server really went away", () => {
  const slow = stalledCopy(true);
  assert.match(slow.headline, /taking longer than expected/);
  assert.doesNotMatch(slow.body, /Quit/);
  assert.match(slow.body, /may still finish on its own/);

  const gone = stalledCopy(false);
  assert.equal(gone.headline, "The server hasn't come back");
  assert.match(gone.body, /Quit Agent Control Center and open it again/);
  // Reopening is genuinely the fix: `control-center start` applies a pending update on the way up.
  assert.match(gone.body, /picks the update up on launch/);
});

/**
 * The scheduling half of "a release should be visible ASAP". These specs exist because the
 * banner previously fetched once on mount and never again — and it mounts in a persistent
 * layout, so a window left open never re-checked at all.
 */
test("with no answer yet, the banner always asks", () => {
  assert.equal(shouldRecheck({ lastCheckedAt: null, now: 0 }), true);
  assert.equal(
    shouldRecheck({ lastCheckedAt: null, now: 0, becameVisible: true }),
    true,
  );
});

test("an idle window re-checks on the interval, not before", () => {
  const at = 1_000_000;
  assert.equal(shouldRecheck({ lastCheckedAt: at, now: at }), false);
  assert.equal(
    shouldRecheck({ lastCheckedAt: at, now: at + RECHECK_MS - 1 }),
    false,
  );
  assert.equal(shouldRecheck({ lastCheckedAt: at, now: at + RECHECK_MS }), true);
});

test("a window looked at again checks sooner than the full interval", () => {
  const at = 1_000_000;
  // The whole point: a window hidden for days shouldn't wait out an interval that already
  // ticked by unseen.
  assert.equal(
    shouldRecheck({
      lastCheckedAt: at,
      now: at + VISIBLE_RECHECK_MS,
      becameVisible: true,
    }),
    true,
  );
  assert.ok(VISIBLE_RECHECK_MS < RECHECK_MS, "…but it is genuinely sooner");
});

test("focus is floored, so flicking between windows can't become a request loop", () => {
  const at = 1_000_000;
  for (const delta of [0, 1, 1_000, VISIBLE_RECHECK_MS - 1]) {
    assert.equal(
      shouldRecheck({ lastCheckedAt: at, now: at + delta, becameVisible: true }),
      false,
      `refocusing after ${delta}ms must not fetch`,
    );
  }
});

test("a backwards clock holds rather than fetching on every tick", () => {
  // Both stamps come from different clocks (the server's `checkedAt` and the browser's `now`),
  // so a negative age is reachable without anything being wrong. Holding is the direction that
  // can't burn the request budget.
  assert.equal(
    shouldRecheck({ lastCheckedAt: 1_000_000, now: 0, becameVisible: true }),
    false,
  );
});

/**
 * The Settings card has to answer "am I current?" in every state, including the ones the banner
 * renders as nothing. A state with no answer here reads as a broken check.
 */
test("versionSummary has an answer for every state", () => {
  const base = { current: "0.9.0", latest: "0.9.0", updateAvailable: false, packaged: true };
  const states = [
    undefined,
    "offline",
    "rate-limited",
    "publishing",
    "no-releases",
  ];
  for (const unavailable of states) {
    const s = versionSummary({ ...base, unavailable });
    assert.ok(s.headline.length > 0, `${unavailable}: headline`);
    assert.ok(s.body.length > 0, `${unavailable}: body`);
    // Whatever the state, the version actually installed is the fact the user came for.
    assert.match(`${s.headline} ${s.body}`, /0\.9\.0/, `${unavailable}: names the version`);
  }
});

test("versionSummary leads with the new version when one is available", () => {
  const s = versionSummary({
    current: "0.9.0",
    latest: "0.10.0",
    updateAvailable: true,
    packaged: true,
  });
  assert.match(s.headline, /0\.10\.0 is available/);
  assert.equal(s.tone, "info");
});

test("versionSummary explains a mid-publish release rather than staying silent", () => {
  // Someone who just read the release announcement and finds nothing offered would otherwise
  // conclude the check is broken. This is the one "unavailable" worth spelling out.
  const s = versionSummary({
    current: "0.9.0",
    latest: "0.10.0",
    updateAvailable: false,
    packaged: true,
    unavailable: "publishing",
  });
  assert.match(s.headline, /0\.10\.0 is still publishing/);
  assert.match(s.body, /couple of minutes/);
  assert.notEqual(s.tone, "warn", "nothing is wrong — it's just not ready");
});

test("versionSummary points a checkout at git pull, not at the update button", () => {
  const s = versionSummary({
    current: "0.9.0",
    latest: "0.10.0",
    // A checkout can report an update as available; offering to install it would be a lie.
    updateAvailable: true,
    packaged: false,
  });
  assert.match(s.body, /git pull/);
  assert.doesNotMatch(s.headline, /available/);
});

test("no copy builder puts a filesystem path inside a sentence", () => {
  // The path is rendered as a path — mono, truncating, with a title — beside the log
  // disclosure. Mid-sentence it's a wall of characters that pushes the real words off screen.
  for (const { body } of [
    stalledCopy(true),
    stalledCopy(false),
    blockedCopy(2),
  ]) {
    assert.doesNotMatch(body, /\//, body);
  }
});

// ------------------------------------------------------ how old is the answer

test("checkedAgo names every unit, and its boundaries", () => {
  const s = 1000;
  const at = 10_000_000;
  // "just now" has to cover a whole "Check now" round trip, or a forced check served from the
  // server's floor would read as stale the instant it came back.
  assert.equal(checkedAgo(at, at), "just now");
  assert.equal(checkedAgo(at, at + 44 * s), "just now");
  assert.equal(checkedAgo(at, at + 45 * s), "1 minute ago", "singular, not '1 minutes'");
  assert.equal(checkedAgo(at, at + 90 * s), "2 minutes ago");
  assert.equal(checkedAgo(at, at + 59 * 60 * s), "59 minutes ago");
  assert.equal(checkedAgo(at, at + 60 * 60 * s), "1 hour ago");
  assert.equal(checkedAgo(at, at + 5 * 60 * 60 * s), "5 hours ago");
  assert.equal(checkedAgo(at, at + 30 * 60 * 60 * s), "1 day ago");
  assert.equal(checkedAgo(at, at + 3 * 24 * 60 * 60 * s), "3 days ago");
});

test("checkedAgo never says the answer came from the future", () => {
  // `checkedAt` is the server's clock and `now` is the browser's, so a negative age is
  // reachable with nothing wrong. "in 3 minutes" is never the useful thing to say.
  assert.equal(checkedAgo(10_000_000, 9_000_000), "just now");
});

test("checkedAgo survives a stamp that isn't a real number", () => {
  // It comes off a JSON response, so "always Date.now()" is a property of today's server, not
  // of the type. NaN made every comparison false and rendered "NaN days ago".
  for (const bad of [Number.NaN, Infinity, -Infinity]) {
    assert.equal(checkedAgo(bad, 10_000_000), "just now", String(bad));
    assert.equal(checkedAgo(10_000_000, bad), "just now", String(bad));
  }
});
