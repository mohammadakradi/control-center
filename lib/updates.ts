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
  | "rate-limited";

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
};

const OK_TTL_MS = 6 * 60 * 60 * 1000; // a local tool doesn't need to poll GitHub often
const ERROR_TTL_MS = 30 * 60 * 1000; // …and shouldn't hammer it when it's failing either
const REQUEST_TIMEOUT_MS = 5_000;

let cache: { at: number; value: UpdateStatus } | null = null;

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
  if (!release?.tag_name || release.draft || release.prerelease) {
    return { ...base, unavailable: "no-releases" };
  }

  const latest = release.tag_name.replace(/^v/i, "");
  return {
    ...base,
    latest,
    updateAvailable: compareVersions(latest, current) > 0,
    releaseUrl: release.html_url ?? null,
    releaseName: release.name ?? null,
    publishedAt: release.published_at ?? null,
  };
}

/**
 * Latest release for the configured repo, cached in memory. Safe to call per page load.
 * `fetchImpl` and `now` exist so the specs can drive it without a network.
 */
export async function checkForUpdate({
  force = false,
  fetchImpl = fetch,
  now = Date.now(),
}: {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: number;
} = {}): Promise<UpdateStatus> {
  if (!force && cache) {
    const ttl = cache.value.unavailable ? ERROR_TTL_MS : OK_TTL_MS;
    if (now - cache.at < ttl) return cache.value;
  }

  const fail = (unavailable: UpdateUnavailable): UpdateStatus => {
    const value = { ...evaluate(APP_VERSION, null, now), unavailable };
    cache = { at: now, value };
    return value;
  };

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

  const value = evaluate(APP_VERSION, body, now);
  cache = { at: now, value };
  return value;
}

/** Test seam: drop the memoized answer. */
export function resetUpdateCache() {
  cache = null;
}
