import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };

// In-memory fixed-window limiter. Fine for this app: single instance, no external
// cache/infra layer (see .swe/notes.md). Resets on process restart — acceptable for
// throttling brute-force/DoS attempts against local auth endpoints.
const buckets = new Map<string, Bucket>();

/** Returns true if the call for `key` is within `limit` requests per `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

/** Best-effort client IP from proxy headers; falls back to a shared bucket if absent
 * (still throttles a single unproxied attacker, just not per-IP). */
export function clientIp(request: NextRequest | Request): string {
  const headers = request.headers;
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}
