/**
 * Specs for the update check. Two things matter here: the comparison must not claim an
 * update when there isn't one (0.10.0 vs 0.9.0 is the classic string-compare bug), and every
 * failure path must land on a quiet "don't know" rather than throwing into a page render.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, compareVersions, evaluate, resetUpdateCache } from "./updates";

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
  const release = {
    tag_name: "v0.3.0",
    name: "0.3.0 — folder picker",
    html_url: "https://github.com/o/r/releases/tag/v0.3.0",
    published_at: "2026-08-04T00:00:00Z",
  };
  const ahead = evaluate("0.2.0", release, 1000);
  assert.equal(ahead.updateAvailable, true);
  assert.equal(ahead.latest, "0.3.0", "the v prefix is stripped for display");
  assert.equal(ahead.releaseUrl, release.html_url);

  assert.equal(evaluate("0.3.0", release, 1000).updateAvailable, false, "same version");
  assert.equal(evaluate("0.4.0", release, 1000).updateAvailable, false, "ahead of the release");
});

test("drafts and prereleases are never offered as updates", () => {
  const base = { tag_name: "v9.9.9", html_url: "u" };
  for (const odd of [{ ...base, draft: true }, { ...base, prerelease: true }, {}, null]) {
    const status = evaluate("0.1.0", odd, 1000);
    assert.equal(status.updateAvailable, false);
    assert.equal(status.unavailable, "no-releases");
  }
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
    return reply(200, { tag_name: "v99.0.0", html_url: "u" });
  }) as unknown as typeof fetch;

  await checkForUpdate({ fetchImpl, now: 0 });
  await checkForUpdate({ fetchImpl, now: 60_000 });
  assert.equal(calls, 1, "second call inside the TTL is served from cache");

  await checkForUpdate({ fetchImpl, now: 7 * 60 * 60 * 1000 });
  assert.equal(calls, 2, "…and refreshed once the TTL expires");

  await checkForUpdate({ fetchImpl, now: 7 * 60 * 60 * 1000, force: true });
  assert.equal(calls, 3, "force bypasses the cache");
});

test("a failed check is retried sooner than a successful one", async () => {
  resetUpdateCache();
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return reply(403);
  }) as unknown as typeof fetch;

  await checkForUpdate({ fetchImpl, now: 0 });
  await checkForUpdate({ fetchImpl, now: 10 * 60 * 1000 });
  assert.equal(calls, 1, "still inside the 30min error TTL");

  await checkForUpdate({ fetchImpl, now: 31 * 60 * 1000 });
  assert.equal(calls, 2);
});
