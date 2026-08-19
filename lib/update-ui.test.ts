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
  failureCopy,
  isFreshRun,
  phaseForRun,
  phaseOnLoad,
  sentenceCase,
  stalledCopy,
  startErrorCopy,
  taskCount,
  uptodateCopy,
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
