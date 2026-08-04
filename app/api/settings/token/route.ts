import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  SecretsError,
  clearUserToken,
  getUserTokenStatus,
  secretsConfigured,
  setUserToken,
} from "@/lib/secrets";
import { verifyAnthropicToken } from "@/lib/token-verify";

export const dynamic = "force-dynamic";

// The user's Anthropic token — WRITE-ONLY. GET returns safe metadata; the token
// itself is never included in any response, on any path (including errors).

const TokenSchema = z.object({
  // `claude setup-token` → sk-ant-oat…; API keys → sk-ant-api…. Prefix-check so
  // pasted garbage fails fast; length cap so nobody stores a novel in the vault.
  token: z
    .string()
    .trim()
    .min(20, "That doesn't look like an Anthropic token")
    .max(1024, "Token is too long")
    .regex(/^sk-ant-/, "Anthropic tokens start with sk-ant-"),
});

// GET /api/settings/token — { configured, kind?, last4? } for the signed-in user.
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({
    ...getUserTokenStatus(user.id),
    vaultReady: secretsConfigured(),
  });
}

// POST /api/settings/token — set or replace the signed-in user's token.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!rateLimit(`token:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }
  if (!secretsConfigured()) {
    return NextResponse.json(
      { error: "Server is missing SECRETS_MASTER_KEY — token storage is disabled (see .env.example)" },
      { status: 503 },
    );
  }

  const parsed = TokenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid token" },
      { status: 400 },
    );
  }

  // The prefix tells us which env var the runner must set — no user toggle to get wrong.
  const token = parsed.data.token;
  const kind = token.startsWith("sk-ant-oat") ? "oauth" : "api-key";

  // Prove the credential authenticates before storing it, so a bad paste fails here
  // rather than when a dispatched task dies mid-run. A verification outage is not the
  // user's fault — store the token and say so instead of blocking them.
  const verified = await verifyAnthropicToken(token, kind);
  if (!verified.ok && !verified.unreachable) {
    return NextResponse.json({ error: verified.reason }, { status: 400 });
  }

  try {
    setUserToken(user.id, token, kind);
  } catch (err) {
    const message =
      err instanceof SecretsError ? err.message : "Failed to store the token";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({
    ...getUserTokenStatus(user.id),
    vaultReady: true,
    // Set when the token was stored without a successful check (Anthropic unreachable),
    // so the UI can say "saved, but unverified" rather than implying it works.
    ...(verified.ok ? {} : { warning: verified.reason }),
  });
}

// DELETE /api/settings/token — clear the signed-in user's token.
export async function DELETE() {
  const user = await getCurrentUser();
  clearUserToken(user.id);
  return NextResponse.json({ configured: false, vaultReady: secretsConfigured() });
}
