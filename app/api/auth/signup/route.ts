import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createSession, hashPassword, normalizeEmail, toPublicUser } from "@/lib/auth";
import { newId } from "@/lib/util";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(256),
});

// POST /api/auth/signup — create an account and start a session.
export async function POST(request: Request) {
  if (!rateLimit(`signup:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  const parsed = SignupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid email or password" },
      { status: 400 },
    );
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  const id = newId("user");
  db.insert(users)
    .values({ id, email, passwordHash: hashPassword(parsed.data.password) })
    .run();
  await createSession(id);

  const user = db.select().from(users).where(eq(users.id, id)).get()!;
  return NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
}
