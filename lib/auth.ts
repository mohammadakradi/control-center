import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";

export const SESSION_COOKIE = "session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SCRYPT_KEYLEN = 64;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Looks up the user for a raw session token, deleting the row if it's expired. Used by
 * both `getCurrentUser` (Server Components/Route Handlers, via the `next/headers` cookie
 * jar) and `proxy.ts` (via `NextRequest.cookies`) so there's one place that owns the
 * token → session → user lookup. */
export function verifySessionToken(token: string): User | null {
  const row = db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, hashToken(token)))
    .get();
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
    return null;
  }
  return row.user;
}

/** Creates a session row and sets the HttpOnly cookie. Must run inside a Server Action or
 * Route Handler (where `next/headers`'s `cookies()` is writable). */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  db.insert(sessions).values({ id: hashToken(token), userId, expiresAt }).run();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Deletes the current session (if any) and clears the cookie. */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
  cookieStore.delete(SESSION_COOKIE);
}

/** The signed-in user for the current request, or null. Deduped per-request via `cache()`. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
});

/** Strips the password hash before a user ever reaches a response body. */
export function toPublicUser(user: User) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}
