import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createSession, hashPassword, normalizeEmail, toPublicUser, verifyPassword } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const SigninSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required").max(256),
});

// Not a real account's hash — exists so `verifyPassword` always pays the same scrypt
// cost whether or not the email matches a user, closing the timing side channel that
// would otherwise let an attacker enumerate valid emails by response latency.
const DUMMY_HASH = hashPassword(randomDummyPassword());

function randomDummyPassword(): string {
  return Math.random().toString(36);
}

// POST /api/auth/signin — verify credentials and start a session.
export async function POST(request: Request) {
  if (!rateLimit(`signin:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  const parsed = SigninSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid email or password" },
      { status: 400 },
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const user = db.select().from(users).where(eq(users.email, email)).get();
  // Always run verifyPassword, even when there's no user, so the response time doesn't
  // leak whether the email exists. Same error either way — don't leak which one it was.
  const ok = verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ user: toPublicUser(user) }, { status: 200 });
}
