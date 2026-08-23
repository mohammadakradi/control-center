/**
 * Specs for the update check. Two things matter here: the comparison must not claim an
 * update when there isn't one (0.10.0 vs 0.9.0 is the classic string-compare bug), and every
 * failure path must land on a quiet "don't know" rather than throwing into a page render.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkForUpdate,
  compareVersions,
  ERROR_TTL_MS,
  evaluate,
  FORCE_FLOOR_MS,
  OK_TTL_MS,
  RATE_LIMIT_TTL_MS,
  releaseTarball,
  resetUpdateCache,
} from "./updates";

/** A release payload carrying the asset an update is actually installed from. */
const published = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: "u",
  assets: [
    { name: releaseTarball(tag.replace(/^v/i, "")) },
    { name: "install.sh" },
    { name: "SHA256SUMS" },
  ],
  ...extra,
});

test("compareVersions orders numerically, not lexically", () => {
  assert.equal(compareVersions("0.10.0", "0.9.0"), 1, "10 > 9 — string compare gets this wrong");
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
});

test("compareVersions tolerates v-prefixes and short versions", () => {
  assert.equal(compareVersions("v1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("V2", "1.9.9"), 1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0, "missing segments are zero");
});

test("a prerelease sorts below the release it leads to", () => {
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.1"), 1);
});

test("evaluate flags an update only when the release is genuinely newer", () => {
  const release = published("v0.3.0", {
    name: "0.3.0 — folder picker",
    html_url: "https://github.com/o/r/releases/tag/v0.3.0",
    published_at: "2026-08-04T00:00:00Z",
  });
  const ahead = evaluate("0.2.0", release, 1000);
  assert.equal(ahead.updateAvailable, true);
  assert.equal(ahead.latest, "0.3.0", "the v prefix is stripped for display");
  assert.equal(ahead.releaseUrl, release.html_url);

  assert.equal(evaluate("0.3.0", release, 1000).updateAvailable, false, "same version");
  assert.equal(evaluate("0.4.0", release, 1000).updateAvailable, false, "ahead of the release");
});

test("drafts and prereleases are never offered as updates", () => {
  const base = published("v9.9.9");
  for (const odd of [{ ...base, draft: true }, { ...base, prerelease: true }, {}, null]) {
    const status = evaluate("0.1.0", odd, 1000);
    assert.equal(status.updateAvailable, false);
    assert.equal(status.unavailable, "no-releases");
  }
});

/**
 * The bug this whole guard exists for. `release: published` fires the workflow, which uploads
 * the tarball only after typecheck, lint, test, build and pack — so for those minutes the API
 * reports a tag whose `control-center-<v>.tar.gz` isn't there, and `apply_update`'s download
 * 404s. Every release had that window.
 */
test("a release whose tarball hasn't uploaded yet is not offered", () => {
  const midPublish = {
    tag_name: "v0.10.0",
    html_url: "u",
    // What GitHub really returns between "Publish release" and the workflow's upload step.
    assets: [] as { name?: string }[],
  };
  const status = evaluate("0.9.0", midPublish, 1000);
  assert.equal(status.updateAvailable, false, "nothing to download — don't offer it");
  assert.equal(status.unavailable, "publishing");
  assert.equal(status.latest, "0.10.0", "still reported, so a UI can say what's coming");
});

test("a release carrying its tarball is offered as soon as it lands", () => {
  const status = evaluate("0.9.0", published("v0.10.0"), 1000);
  assert.equal(status.updateAvailable, true);
  assert.equal(status.unavailable, undefined);
});

test("assets that don't include our tarball are not an offer either", () => {
  for (const assets of [
    undefined, // a payload with no array at all
    [{ name: "install.sh" }, { name: "SHA256SUMS" }], // uploaded, but not the tarball
    [{ name: "control-center-0.9.0.tar.gz" }], // the *previous* version's asset
    [{}], // an entry with no name
  ]) {
    const status = evaluate("0.9.0", { tag_name: "v0.10.0", html_url: "u", assets }, 1000);
    assert.equal(status.updateAvailable, false, JSON.stringify(assets));
    assert.equal(status.unavailable, "publishing");
  }
});

test("only a *newer* uninstallable release reports publishing", () => {
  // An install already on (or ahead of) the newest release has nothing pending, so an empty
  // asset list is nobody's problem — reporting it would pin "publishing" on a current install.
  const bare = { tag_name: "v0.9.0", html_url: "u", assets: [] };
  assert.equal(evaluate("0.9.0", bare, 1000).unavailable, undefined, "same version");
  assert.equal(evaluate("1.0.0", bare, 1000).unavailable, undefined, "ahead of it");
});

test("the tarball name matches the one apply_update builds", () => {
  // `version=${tag#v}; tarball="control-center-$version.tar.gz"` in control-center.sh. If these
  // ever disagree, every update is refused as "publishing" forever.
  assert.equal(releaseTarball("0.10.0"), "control-center-0.10.0.tar.gz");
});

/** Minimal Response stand-in — enough for the paths `checkForUpdate` actually branches on. */
const reply = (status: number, body: unknown = {}): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

test("a repo with no releases reports no-releases, not an error", async () => {
  resetUpdateCache();
  const status = await checkForUpdate({ fetchImpl: async () => reply(404) });
  assert.equal(status.unavailable, "no-releases");
  assert.equal(status.updateAvailable, false);
});

test("GitHub rate limiting is reported as such", async () => {
  resetUpdateCache();
  const status = await checkForUpdate({ fetchImpl: async () => reply(403) });
  assert.equal(status.unavailable, "rate-limited");
});

test("a network failure degrades to offline instead of throwing", async () => {
  resetUpdateCache();
  const status = await checkForUpdate({
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND api.github.com");
    },
  });
  assert.equal(status.unavailable, "offline");
  assert.equal(status.updateAvailable, false);
});

test("malformed JSON degrades to offline", async () => {
  resetUpdateCache();
  const badJson = {
    status: 200,
    ok: true,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
  } as unknown as Response; // a throwing `json` doesn't overlap with Response structurally
  const status = await checkForUpdate({ fetchImpl: async () => badJson });
  assert.equal(status.unavailable, "offline");
});

test("results are cached so page loads don't each hit GitHub", async () => {
  resetUpdateCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return reply(200, published("v99.0.0"));
  }) as unknown as typeof fetch;

  await checkForUpdate({ fetchImpl, now: 0 });
  await checkForUpdate({ fetchImpl, now: 60_000 });
  assert.equal(calls, 1, "second call inside the TTL is served from cache");

  // 30 minutes, not the six hours this used to be: a window left open has to notice a release
  // without being reloaded, and 2 requests/hour is a wide margin under the 60/hour budget.
  await checkForUpdate({ fetchImpl, now: OK_TTL_MS - 1 });
  assert.equal(calls, 1, "still inside the OK TTL");
  await checkForUpdate({ fetchImpl, now: OK_TTL_MS + 1 });
  assert.equal(calls, 2, "…and refreshed once it expires");

  await checkForUpdate({ fetchImpl, now: OK_TTL_MS + 1 + FORCE_FLOOR_MS + 1, force: true });
  assert.equal(calls, 3, "force bypasses the TTL");
});

test("a forced check can't be used to burn the GitHub request budget", async () => {
  resetUpdateCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return reply(200, published("v99.0.0"));
  }) as unknown as typeof fetch;

  await checkForUpdate({ fetchImpl, now: 0 });
  assert.equal(calls, 1);

  // `?force=1` has no auth in front of it. Hammering it serves the cache instead of GitHub —
  // the answer is seconds old, so this is honest rather than a refusal.
  for (const now of [1, 500, 30_000, 59_999]) {
    await checkForUpdate({ fetchImpl, now, force: true });
  }
  assert.equal(calls, 1, "every force inside the floor was served from cache");

  await checkForUpdate({ fetchImpl, now: FORCE_FLOOR_MS + 1, force: true });
  assert.equal(calls, 2, "past the floor, a force really does re-check");
});

/**
 * The floor above is only half of it, and the sequential test would pass with this broken.
 *
 * The cache is written *after* a fetch resolves, so N calls arriving inside that window all see
 * the same empty cache and all go to GitHub — making the floor bypassable by concurrency instead
 * of patience. From inside the container, `for i in $(seq 60); do curl '…?force=1' & done` burnt
 * the entire hourly budget in one burst. Found by the correctness review, which reproduced ten
 * real fetches from ten concurrent forced calls.
 */
test("concurrent checks share one request instead of each hitting GitHub", async () => {
  resetUpdateCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    // Resolve on a later turn, so all ten callers are genuinely in the window together.
    await new Promise((r) => setTimeout(r, 5));
    return reply(200, published("v99.0.0"));
  }) as unknown as typeof fetch;

  const results = await Promise.all(
    Array.from({ length: 10 }, () => checkForUpdate({ fetchImpl, force: true, now: 0 })),
  );
  assert.equal(calls, 1, "ten concurrent forced checks, one request");
  // Every caller still gets a real answer — coalescing must not starve the late arrivals.
  for (const r of results) assert.equal(r.latest, "99.0.0");
});

test("a coalesced check releases its slot, even when it fails", async () => {
  // A rejecting fetch that left `inFlight` set would wedge every later check onto a promise
  // that can never settle — the update check would go permanently silent.
  resetUpdateCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    throw new Error("network down");
  }) as unknown as typeof fetch;

  const first = await checkForUpdate({ fetchImpl, now: 0 });
  assert.equal(first.unavailable, "offline");
  await checkForUpdate({ fetchImpl, now: ERROR_TTL_MS + 1 });
  assert.equal(calls, 2, "the second check really ran");
});

test("a release still publishing is re-checked in minutes, not half an hour", async () => {
  resetUpdateCache();
  let calls = 0;
  // Mid-publish first, then the assets land — the real sequence during a release.
  const fetchImpl = (async () => {
    calls++;
    return reply(
      200,
      calls === 1
        ? { tag_name: "v99.0.0", html_url: "u", assets: [] }
        : published("v99.0.0"),
    );
  }) as unknown as typeof fetch;

  const first = await checkForUpdate({ fetchImpl, now: 0 });
  assert.equal(first.unavailable, "publishing");

  await checkForUpdate({ fetchImpl, now: 60_000 });
  assert.equal(calls, 1, "inside the 2min publishing TTL");

  const second = await checkForUpdate({ fetchImpl, now: 2 * 60 * 1000 + 1 });
  assert.equal(calls, 2);
  assert.equal(second.updateAvailable, true, "picked up as soon as the tarball existed");
});

test("a failed check is retried sooner than a successful one", async () => {
  // Asserted on the constants, not just implied by two hard-coded timestamps: this claim
  // silently became false when OK_TTL_MS dropped from six hours to thirty minutes and matched
  // ERROR_TTL_MS exactly, and the old version of this test passed throughout (found in review).
  assert.ok(
    ERROR_TTL_MS < OK_TTL_MS,
    `an offline check must come back sooner: ${ERROR_TTL_MS} vs ${OK_TTL_MS}`,
  );

  resetUpdateCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return reply(500); // a plain failure — 403 is the rate-limit case below
  }) as unknown as typeof fetch;

  await checkForUpdate({ fetchImpl, now: 0 });
  await checkForUpdate({ fetchImpl, now: ERROR_TTL_MS - 1 });
  assert.equal(calls, 1, "still inside the error TTL");

  await checkForUpdate({ fetchImpl, now: ERROR_TTL_MS + 1 });
  assert.equal(calls, 2);
});

test("being rate-limited backs off longer than an ordinary failure", async () => {
  // The one failure where retrying sooner cannot possibly help: the budget is per-IP per-hour,
  // so an early retry spends another 403 and re-arms the same wait.
  assert.ok(RATE_LIMIT_TTL_MS > ERROR_TTL_MS);

  resetUpdateCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return reply(403);
  }) as unknown as typeof fetch;

  await checkForUpdate({ fetchImpl, now: 0 });
  await checkForUpdate({ fetchImpl, now: ERROR_TTL_MS + 1 });
  assert.equal(calls, 1, "an ordinary error's TTL is not enough to retry a rate-limited one");

  await checkForUpdate({ fetchImpl, now: RATE_LIMIT_TTL_MS + 1 });
  assert.equal(calls, 2);
});

test("dropping the cache mid-flight is not undone by the answer that was already coming", async () => {
  // `resetUpdateCache` is a test seam, not production code — but a seam that half-works makes
  // every later spec order-dependent, so it gets pinned like anything else. Before the
  // generation counter, the in-flight fetch wrote its answer into the cache *after* the reset
  // (found in review), so the next spec started from state it thought it had cleared.
  resetUpdateCache();
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const fetchImpl = (async () => {
    calls++;
    await gate;
    return reply(200, published("v99.0.0"));
  }) as unknown as typeof fetch;

  const inFlight = checkForUpdate({ fetchImpl, now: 0 });
  resetUpdateCache(); // …while that one is still on the wire
  release();
  assert.equal((await inFlight).latest, "99.0.0", "the caller still gets its answer");

  // The reset really held: this is a fresh era, so it goes to the network again rather than
  // being served the pre-reset answer.
  await checkForUpdate({ fetchImpl, now: 1 });
  assert.equal(calls, 2);
});

test("a payload whose tag_name isn't a string is refused, not a 500", () => {
  // `evaluate` is called outside `checkForUpdate`'s try/catch on purpose, so a throw here would
  // become a 500 from a route documented as never failing. Reachable via UPDATE_REPO/CC_REPO
  // pointing at something that isn't github.com. Found by the security audit.
  for (const tag of [42, true, {}, [], null, undefined]) {
    const status = evaluate("0.9.0", { tag_name: tag } as never, 1000);
    assert.equal(status.unavailable, "no-releases", JSON.stringify(tag));
    assert.equal(status.updateAvailable, false);
  }
});
