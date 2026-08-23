/**
 * "Is there a newer release?" — the in-app half of the update story.
 *
 * The `control-center` CLI checks GitHub and applies updates when you start the app; this
 * module covers the other case, an instance that's been running since before a release
 * landed. It only ever *reports* — nothing here mutates the install, and nothing here needs
 * the Docker socket.
 *
 * Everything degrades to "don't know", never to an error the user has to care about: the
 * dashboard is fully usable offline, and an update banner is the least important thing on
 * the screen.
 */
import { APP_VERSION, IS_PACKAGED, UPDATE_REPO } from "@/lib/version";

/** Why we have no answer. Absent when the check succeeded. */
export type UpdateUnavailable =
  /** GitHub unreachable, or the request timed out. */
  | "offline"
  /** The repo has no published releases yet. */
  | "no-releases"
  /** Unauthenticated GitHub API allows 60 requests/hour per IP. */
  | "rate-limited"
  /**
   * A newer release exists but its install assets aren't uploaded yet, so nothing can be
   * installed from it. Transient — minutes — and resolves itself (see `releaseTarball`).
   */
  | "publishing";

export type UpdateStatus = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  /** False in a git checkout — the CLI can't update a source tree, so the UI stays quiet. */
  packaged: boolean;
  checkedAt: number;
  unavailable?: UpdateUnavailable;
};

type GithubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string }[];
};

/**
 * How long an answer is reused.
 *
 * This was six hours, which — combined with a banner that only ever fetched once, on mount —
 * is why several releases came and went unnoticed on a window that was never closed. Thirty
 * minutes is two requests an hour against an unauthenticated budget of **sixty**, so even with
 * the manual check below there is a wide margin before anyone sees `rate-limited`.
 */
export const OK_TTL_MS = 30 * 60 * 1000;
/**
 * A failed check is retried **sooner** than a successful one: "offline" usually means a laptop
 * that was asleep or a network that was briefly away, and the answer is expected to change.
 *
 * This had silently become equal to `OK_TTL_MS` when that dropped from six hours to thirty
 * minutes, which made the long-standing spec "a failed check is retried sooner than a successful
 * one" describe nothing (it passed by never comparing the two). Caught in review.
 */
export const ERROR_TTL_MS = 10 * 60 * 1000;
/**
 * …except rate limiting, which is the one failure where retrying sooner cannot help: the budget
 * is per-IP per-hour, so an early retry just spends another 403 and re-arms the same wait.
 */
export const RATE_LIMIT_TTL_MS = 20 * 60 * 1000;
/**
 * `publishing` is the one state that resolves on its own, in the couple of minutes an upload
 * takes, so it gets a much shorter TTL: holding a release back for half an hour after its assets
 * landed would trade one delay for another.
 */
const PUBLISHING_TTL_MS = 2 * 60 * 1000;
/**
 * The floor a **forced** check can't go under.
 *
 * `GET /api/updates?force=1` backs a "Check now" button, and that route has no auth in front of
 * it — it is reachable over loopback from inside the container where a task's Bash tool runs (the
 * same gap documented for the backlog routes). Without a floor, forcing is a primitive for
 * burning the unauthenticated 60-requests-per-hour GitHub budget, after which every user's
 * *honest* check answers `rate-limited`. Serving the cache inside the floor isn't a refusal: the
 * answer is seconds old, and `checkedAt` lets the caller say so.
 *
 * **Two minutes rather than one, and the arithmetic is the reason.** At a 60s floor the worst
 * case is 60 forced network calls an hour — *exactly* GitHub's unauthenticated per-IP budget, so
 * a caller dripping one request every 61 seconds could still drain the whole quota while
 * technically obeying the floor (the security audit's finding). At 120s the ceiling is 30/hour,
 * leaving half the budget for the scheduled checks and for anything else on the machine using
 * the GitHub API. Residual, knowingly: this is a floor, not a token bucket, so a patient drip
 * still costs half the quota. A bucket is the real fix if that ever matters; the actor who can
 * reach this endpoint already has stronger primitives (see CLAUDE.md's no-auth notes), and the
 * only harm is a temporarily stale update check.
 */
export const FORCE_FLOOR_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;

/** How long a cached answer stays good, by what it says. */
function ttlFor(value: UpdateStatus): number {
  switch (value.unavailable) {
    case undefined:
      return OK_TTL_MS;
    case "publishing":
      return PUBLISHING_TTL_MS;
    case "rate-limited":
      return RATE_LIMIT_TTL_MS;
    default:
      return ERROR_TTL_MS;
  }
}

let cache: { at: number; value: UpdateStatus } | null = null;
/** A check already on the wire. See `checkForUpdate` — this is what makes the floors real. */
let inFlight: Promise<UpdateStatus> | null = null;
/**
 * Bumped by `resetUpdateCache`. A fetch that was already on the wire when the reset happened
 * must not write its answer into the cache afterwards — without this, dropping the cache
 * mid-flight silently repopulated it a moment later (found in review). Nothing in the app calls
 * `resetUpdateCache`, so this keeps a test seam honest rather than fixing a shipped bug.
 */
let generation = 0;

/** Split "1.10.2-rc.1" into numeric core parts plus the prerelease tail. */
function parseVersion(raw: string): { core: number[]; pre: string | null } {
  const cleaned = raw.trim().replace(/^v/i, "");
  const [core, ...rest] = cleaned.split("-");
  return {
    core: core.split(".").map((n) => Number.parseInt(n, 10) || 0),
    pre: rest.length ? rest.join("-") : null,
  };
}

/**
 * Semver-ish comparison: -1 if `a` < `b`, 0 if equal, 1 if `a` > `b`.
 * Numeric segments compare as numbers (so 0.10.0 > 0.9.0, which a string compare gets wrong),
 * and a prerelease sorts *below* the release it leads to (1.0.0-rc.1 < 1.0.0).
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  const len = Math.max(va.core.length, vb.core.length);
  for (let i = 0; i < len; i++) {
    const diff = (va.core[i] ?? 0) - (vb.core[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1; // a is the full release
  if (vb.pre === null) return -1;
  return va.pre > vb.pre ? 1 : -1;
}

/**
 * The one asset an update is actually installed from. `apply_update` in
 * `infra/release/control-center.sh` builds exactly this name (`control-center-$version.tar.gz`
 * from `${tag#v}`), so this string — not the tag — is what decides whether a release can be
 * installed at all.
 */
export function releaseTarball(version: string): string {
  return `control-center-${version}.tar.gz`;
}

/**
 * Is this release actually installable *yet*?
 *
 * A release appears on the API the instant it is published, but `.github/workflows/release.yml`
 * triggers on `release: published` and uploads the assets at the very **end** — after typecheck,
 * lint, test, `next build` and `pack.sh`. For those minutes `tag_name` names a version whose
 * tarball does not exist, and that window is a real bug rather than a theoretical one: the
 * banner offered the new version, the button ran `apply_update`, and `curl` 404'd on the
 * download. Every release had one.
 *
 * So a tag alone is not an offer. `assets` missing entirely also reads as not-installable: a
 * real payload always carries the array, and a release published without our tarball (a fork
 * that doesn't use this workflow) genuinely has nothing `apply_update` could fetch.
 */
function isInstallable(release: GithubRelease, version: string): boolean {
  const wanted = releaseTarball(version);
  // `Array.isArray`, not `?? []`: the payload is only *typed* as `GithubRelease`, and `assets`
  // arriving as a string or a number would make `.some` a TypeError. `evaluate` is called
  // outside `checkForUpdate`'s try/catch — deliberately, since it's meant to be pure — so that
  // throw would surface as a 500 from `GET /api/updates` instead of the graceful "don't know"
  // this module promises everywhere else. Reachable via `UPDATE_REPO`/`CC_REPO` pointing at
  // anything that isn't github.com, which is a documented, supported thing to do.
  if (!Array.isArray(release.assets)) return false;
  return release.assets.some((a) => a?.name === wanted);
}

/** Turn a releases API payload into a status. Pure — the network lives in `checkForUpdate`. */
export function evaluate(
  current: string,
  release: GithubRelease | null,
  now: number,
): UpdateStatus {
  const base = {
    current,
    packaged: IS_PACKAGED,
    checkedAt: now,
    latest: null,
    updateAvailable: false,
    releaseUrl: null,
    releaseName: null,
    publishedAt: null,
  } satisfies UpdateStatus;

  // `/releases/latest` never returns drafts, but it can return a prerelease if that's all
  // there is, and a hand-rolled payload could be anything. Don't offer either as an update.
  // `typeof`, not just truthiness: this object is only *typed* as a release. A payload whose
  // `tag_name` is a number is truthy, and `.replace` on it throws — from `evaluate`, which is
  // called outside `checkForUpdate`'s try/catch on purpose (it's meant to be pure), so the throw
  // would surface as a 500 from `GET /api/updates` and break the "never fails" contract this
  // module advertises everywhere else. Reachable by pointing `UPDATE_REPO`/`CC_REPO` at anything
  // that isn't github.com, which is a documented, supported thing to do.
  if (
    typeof release?.tag_name !== "string" ||
    !release.tag_name ||
    release.draft ||
    release.prerelease
  ) {
    return { ...base, unavailable: "no-releases" };
  }

  const latest = release.tag_name.replace(/^v/i, "");
  const newer = compareVersions(latest, current) > 0;
  // Only a *newer* release that can't be installed is worth a reason code: the same or an older
  // one having no tarball is nobody's problem, and reporting it would put a permanent
  // "publishing" on installs that are already current.
  const pending = newer && !isInstallable(release, latest);
  return {
    ...base,
    latest,
    updateAvailable: newer && !pending,
    releaseUrl: release.html_url ?? null,
    releaseName: release.name ?? null,
    publishedAt: release.published_at ?? null,
    ...(pending ? { unavailable: "publishing" as const } : {}),
  };
}

/**
 * Latest release for the configured repo, cached in memory. Safe to call per page load.
 * `fetchImpl` and `now` exist so the specs can drive it without a network.
 *
 * **Concurrent callers share one request.** The cache alone cannot enforce any floor, because it
 * is only written *after* a fetch resolves — so N calls arriving inside that window all see the
 * same empty/stale cache and all go to GitHub. That makes `FORCE_FLOOR_MS` trivially bypassable
 * by concurrency rather than by patience (`for i in $(seq 60); do curl '…?force=1' & done` from
 * inside the container burns the whole hourly budget in one burst), which is the exact scenario
 * the floor exists to prevent. The correctness review reproduced it: ten concurrent forced calls
 * performed ten real fetches. So an in-flight check is memoized too, and later arrivals await it.
 *
 * A forced call deliberately *joins* a non-forced one already in flight: both would ask GitHub
 * the same question and get the same answer, so there is nothing to gain by asking twice. Note
 * this means a caller passing its own `fetchImpl` can receive another caller's result if the two
 * genuinely overlap — irrelevant in the app (one `fetch`) and avoided in the specs, which await
 * each call unless they are testing this behaviour on purpose.
 */
export async function checkForUpdate(opts: {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: number;
} = {}): Promise<UpdateStatus> {
  const { force = false, now = Date.now() } = opts;

  if (cache) {
    const ttl = force ? FORCE_FLOOR_MS : ttlFor(cache.value);
    // Deliberately not guarded against a negative age: a clock that stepped backwards holds the
    // cache rather than refetching on every call, which is the direction that can't burn the
    // request budget.
    if (now - cache.at < ttl) return cache.value;
  }

  if (inFlight) return inFlight;
  // `finally` rather than `then`: the slot has to be released on the rejecting path too, or one
  // unexpected throw would wedge every later check onto a permanently pending promise.
  inFlight = fetchStatus(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The actual network round trip. Only ever called via `checkForUpdate`'s coalescing wrapper. */
async function fetchStatus({
  fetchImpl = fetch,
  now = Date.now(),
}: {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<UpdateStatus> {
  // Which era this fetch belongs to. `resetUpdateCache` bumps the counter, so an answer that
  // was already on the wire when the cache was dropped is still *returned* to its caller but
  // never written back — otherwise the reset undoes itself a moment later.
  const gen = generation;
  const remember = (value: UpdateStatus): UpdateStatus => {
    if (gen === generation) cache = { at: now, value };
    return value;
  };
  const fail = (unavailable: UpdateUnavailable): UpdateStatus =>
    remember({ ...evaluate(APP_VERSION, null, now), unavailable });

  let res: Response;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "control-center-update-check",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return fail("offline"); // no network, DNS failure, or timeout
  }

  if (res.status === 404) return fail("no-releases"); // repo has never published one
  if (res.status === 403 || res.status === 429) return fail("rate-limited");
  if (!res.ok) return fail("offline");

  let body: GithubRelease | null = null;
  try {
    body = (await res.json()) as GithubRelease;
  } catch {
    return fail("offline");
  }

  return remember(evaluate(APP_VERSION, body, now));
}

/** Test seam: drop the memoized answer *and* any in-flight one, so a spec starts from nothing. */
export function resetUpdateCache() {
  cache = null;
  inFlight = null;
  generation++; // so a fetch already on the wire can't write its answer back in
}
