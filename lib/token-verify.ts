import type { TokenKind } from "./secrets";

/** `GET /v1/models` is a free, token-free endpoint — the cheapest way to prove a
 *  credential actually authenticates. Subscription tokens go on `Authorization:
 *  Bearer` with the OAuth beta header; API keys go on `x-api-key`. */
const MODELS_URL = "https://api.anthropic.com/v1/models?limit=1";
const VERIFY_TIMEOUT_MS = 10_000;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string; unreachable?: boolean };

/**
 * Check that a token authenticates before we store it, so a bad paste fails in
 * the settings form instead of hours later when a dispatched task dies with a 401.
 * Never logs or returns the token itself.
 */
export async function verifyAnthropicToken(
  token: string,
  kind: TokenKind,
): Promise<VerifyResult> {
  const headers: Record<string, string> =
    kind === "oauth"
      ? {
          authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
        }
      : { "x-api-key": token, "anthropic-version": "2023-06-01" };

  let res: Response;
  try {
    res = await fetch(MODELS_URL, {
      headers,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Offline / DNS / timeout — don't block the user on our own connectivity.
    return {
      ok: false,
      unreachable: true,
      reason: "Couldn't reach Anthropic to verify the token",
    };
  }

  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason:
        kind === "oauth"
          ? "Anthropic rejected this token. Generate a fresh one with `claude setup-token` and paste the whole value."
          : "Anthropic rejected this API key. Check it was copied in full and hasn't expired or been revoked.",
    };
  }
  return {
    ok: false,
    unreachable: true,
    reason: `Anthropic returned ${res.status} while verifying the token`,
  };
}
