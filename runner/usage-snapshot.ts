/**
 * Claude *plan* rate limits, best-effort.
 *
 * ## Read this before expecting data
 *
 * The SDK can report claude.ai plan rate-limit windows (5-hour, 7-day, per-model), but only
 * when the session has a login **profile** with the right scope. This app injects each
 * user's token through `Options.env` instead (see `runner/user-env.ts`), which the SDK
 * classifies as "missing profile scope" — measured against a real subscription token:
 *
 *     accountInfo()        → { tokenSource: "CLAUDE_CODE_OAUTH_TOKEN", apiProvider: "firstParty" }
 *     subscription_type    → null
 *     rate_limits_available → false
 *
 * So `available: false` is the normal answer here, not an error. It is reported as a
 * first-class result with a reason, and the plumbing is in place so real windows appear by
 * themselves if a future SDK scopes env tokens for it. The genuinely useful usage numbers
 * come from `lib/usage-summary.ts`, which reads what we record per task ourselves.
 *
 * The underlying SDK method is explicitly experimental — "may change or be removed in any
 * release without notice… the method name will change when the API is stabilized" — so it is
 * feature-detected from an allowlist of names and every failure degrades to `available:
 * false`. A shape change must never break the endpoint, let alone a task run.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildTaskEnv } from "./user-env";

/** One rate-limit window, normalized. */
export type UsageWindow = {
  /** e.g. "five_hour", "seven_day", "seven_day_opus" */
  key: string;
  /** Percent of the window consumed, 0-100. */
  utilization: number | null;
  /** ISO 8601, when the window resets. */
  resetsAt: string | null;
};

export type UsageSnapshot = {
  available: boolean;
  /** Why there's no data — shown to the user, so keep it plain. */
  reason?: string;
  /** "pro" | "max" | "team" | "enterprise", or null. */
  subscriptionType: string | null;
  windows: UsageWindow[];
  /** When this snapshot was taken (ISO 8601). */
  fetchedAt: string;
};

/** Names we're willing to call. The current one is explicitly temporary; the others are
 *  what a stabilized rename would plausibly be. An allowlist rather than a prefix scan —
 *  we must never call an arbitrary method just because its name looks right. */
const METHOD_NAMES = [
  "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET",
  "getUsage",
  "usage",
] as const;

/** Spinning a subprocess costs ~1.7s, so don't do it per page load. Cache a positive
 *  result briefly (limits move as the user works) and a negative one for much longer —
 *  "your token can't read plan limits" is a property of the setup, not of the moment. */
const TTL_AVAILABLE_MS = 60_000;
const TTL_UNAVAILABLE_MS = 10 * 60_000;
/** "You haven't saved a token yet" is a state the user is actively fixing — caching it for
 *  ten minutes would show a stale "unavailable" right after they add one in Settings. */
const TTL_TRANSIENT_MS = 15_000;
/** A probe that hasn't answered by now is not going to; don't hold the request open. */
const PROBE_TIMEOUT_MS = 15_000;

/** Bound the cache. Entries are keyed by user id and only ever overwritten, so without a
 *  cap this grows forever if the id space is ever wider than "real accounts" — the runner
 *  endpoint takes an arbitrary id today, and is only safe because it's loopback-only. A
 *  handful of users need a handful of entries; evict oldest-first past that. */
const MAX_CACHED_USERS = 200;

const cache = new Map<string, { snapshot: UsageSnapshot; expiresAt: number }>();
/** Collapse concurrent requests for the same user onto one probe. */
const inFlight = new Map<string, Promise<UsageSnapshot>>();

function remember(userId: string, snapshot: UsageSnapshot, ttlMs: number): void {
  cache.delete(userId); // re-insert so Map iteration order tracks recency
  cache.set(userId, { snapshot, expiresAt: Date.now() + ttlMs });
  while (cache.size > MAX_CACHED_USERS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

function unavailable(reason: string): UsageSnapshot {
  return {
    available: false,
    reason,
    subscriptionType: null,
    windows: [],
    fetchedAt: new Date().toISOString(),
  };
}

/** Pull the windows out of the SDK's `rate_limits` object without assuming its exact keys —
 *  it already carries six and will grow. Anything shaped like a window is included. */
function normalizeWindows(rateLimits: unknown): UsageWindow[] {
  if (typeof rateLimits !== "object" || rateLimits === null) return [];
  const out: UsageWindow[] = [];
  for (const [key, raw] of Object.entries(rateLimits as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const w = raw as Record<string, unknown>;
    if (!("utilization" in w)) continue; // e.g. `extra_usage`, a different shape
    const utilization = typeof w.utilization === "number" && Number.isFinite(w.utilization)
      ? Math.max(0, Math.min(100, w.utilization))
      : null;
    const resetsAt = typeof w.resets_at === "string" ? w.resets_at : null;
    out.push({ key, utilization, resetsAt });
  }
  return out;
}

type Probed = { snapshot: UsageSnapshot; ttlMs: number };

async function probe(userId: string): Promise<Probed> {
  let env;
  try {
    env = buildTaskEnv(userId);
  } catch {
    // Same fail-closed path a dispatch takes, but `buildTaskEnv`'s message is written for
    // someone about to run a task ("…then dispatch again"), which reads oddly here.
    return {
      snapshot: unavailable(
        "No Anthropic token is configured for this account, so there are no plan limits to read. Add one under Settings.",
      ),
      ttlMs: TTL_TRANSIENT_MS,
    };
  }

  // Streaming-input mode with nothing ever pushed: the subprocess starts and we use only
  // its control channel, so no model call is made and nothing is billed (verified: the
  // probe reports session.total_cost_usd === 0).
  async function* noInput(): AsyncGenerator<never> {
    await new Promise(() => {});
    yield undefined as never;
  }

  const session = query({
    prompt: noInput(),
    options: { env, cwd: process.cwd(), allowedTools: [] },
  });

  try {
    const holder = session as unknown as Record<string, unknown>;
    // Read each candidate ONCE: if a future SDK ever exposed this as a getter rather than a
    // plain method, probing with `typeof holder[n]` and then reading it again would fire any
    // side effect twice.
    let fn: ((this: unknown) => Promise<unknown>) | undefined;
    for (const n of METHOD_NAMES) {
      const candidate = holder[n];
      if (typeof candidate === "function") {
        fn = candidate as (this: unknown) => Promise<unknown>;
        break;
      }
    }
    if (!fn) {
      return {
        snapshot: unavailable(
          "This Agent SDK build doesn't expose the usage API (it is experimental and may be renamed).",
        ),
        ttlMs: TTL_UNAVAILABLE_MS,
      };
    }

    const call = fn.call(session) as Promise<unknown>;
    // Tearing the session down rejects any in-flight control call ("Query closed before
    // response received"). If we lose the race, that rejection lands with nobody waiting
    // on it — and Node terminates the process on an unhandled rejection, so a single hung
    // probe would take the runner down and kill every running task with it. Verified: the
    // late rejection is real, so this no-op catch is load-bearing, not defensive noise.
    call.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;
    const raw = (await Promise.race([
      call,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), PROBE_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer))) as Record<string, unknown>;

    const availableFlag = raw?.rate_limits_available;
    const subscriptionType =
      typeof raw?.subscription_type === "string" ? raw.subscription_type : null;

    if (availableFlag !== true) {
      return {
        snapshot: {
          ...unavailable(
            "Claude plan limits aren't readable with a token supplied via the environment — " +
              "the SDK only reports them for a logged-in profile. Your per-task spend below is unaffected.",
          ),
          subscriptionType,
        },
        ttlMs: TTL_UNAVAILABLE_MS,
      };
    }

    const windows = normalizeWindows(raw.rate_limits);
    return {
      snapshot: {
        available: windows.length > 0,
        ...(windows.length === 0
          ? { reason: "The SDK reported limits as available but returned no windows." }
          : {}),
        subscriptionType,
        windows,
        fetchedAt: new Date().toISOString(),
      },
      ttlMs: windows.length > 0 ? TTL_AVAILABLE_MS : TTL_UNAVAILABLE_MS,
    };
  } catch (err) {
    // Experimental API: a throw, a rename, or a changed shape all land here and must read
    // as "no data", never as a failure of the endpoint.
    // A transient failure (timeout, transport hiccup) shouldn't be remembered for long.
    return {
      snapshot: unavailable(`Couldn't read plan limits: ${(err as Error).message}`),
      ttlMs: TTL_TRANSIENT_MS,
    };
  } finally {
    // Query is an AsyncGenerator — returning it ends the stream and tears down the
    // subprocess, so a probe can't leak a process into the long-lived runner.
    try {
      await session.return();
    } catch {
      /* already gone */
    }
  }
}

/** Cached, de-duplicated plan-limit snapshot for one user. Never throws. */
export async function usageSnapshot(userId: string): Promise<UsageSnapshot> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.snapshot;

  const existing = inFlight.get(userId);
  if (existing) return existing;

  const run = probe(userId)
    .catch((err) => ({
      snapshot: unavailable(`Couldn't read plan limits: ${(err as Error).message}`),
      ttlMs: TTL_TRANSIENT_MS,
    }))
    .then(({ snapshot, ttlMs }) => {
      remember(userId, snapshot, ttlMs);
      return snapshot;
    })
    .finally(() => inFlight.delete(userId));

  inFlight.set(userId, run);
  return run;
}

/** Test seam: drop cached snapshots. */
export function clearUsageSnapshotCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Test seam: the normalizer is the part worth pinning, and it's pure. Exercising it through
 *  `usageSnapshot` would mean spawning a real subprocess under a real token. */
export const normalizeWindowsForTest = normalizeWindows;
