import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";
import { LOCAL_USER_ID as LOCAL_ID, LOCAL_USER_EMAIL } from "./identity";

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
    // NOT keyed to NODE_ENV, which is what it looks like it should be: the dashboard is served
    // over plain http on loopback, and `Secure` on an http origin means "never send this
    // cookie" in WebKit — and the Mac app is a WKWebView, so sign-in would silently stop
    // working the moment releases switched to a production build. There is no transport to
    // protect on 127.0.0.1; set CC_HTTPS=1 if you actually front the app with TLS.
    secure: process.env.CC_HTTPS === "1",
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

/**
 * The reserved identity that owns everything done without signing in.
 *
 * Sign-in is optional: the app works out of the box, and creating an account is how you keep
 * your token and tasks private from other people using the same install. Everything that used
 * to require a session now runs as this identity instead, so there is always an owner —
 * "no account" is a *different* workspace, not an absent one.
 *
 * Seeded by `drizzle/0001_local_workspace.sql` with a password hash that can never match.
 */
export { LOCAL_USER_ID } from "./identity";

/** The identity for the current request: the signed-in user, or the local workspace.
 *  Never null, so callers can't accidentally treat "not signed in" as "no data".
 *  Deduped per-request via `cache()`. */
export const getCurrentUser = cache(async (): Promise<User> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = token ? verifySessionToken(token) : null;
  return user ?? localUser();
});

/** True when this request is the open workspace rather than a signed-in account. */
export function isLocalWorkspace(user: Pick<User, "id">): boolean {
  return user.id === LOCAL_ID;
}

/** The signed-in user, or null when browsing anonymously — for UI that must tell them apart
 *  (the sidebar, Settings) rather than just needing an owner. */
export const getSignedInUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
});

/** Fetch the local identity, creating it if a migration hasn't yet (belt and braces: the app
 *  must never fail to have an owner just because migrations were skipped). */
function localUser(): User {
  const existing = db.select().from(users).where(eq(users.id, LOCAL_ID)).get();
  if (existing) return existing;
  db.insert(users)
    .values({ id: LOCAL_ID, email: LOCAL_USER_EMAIL, passwordHash: "!" })
    .onConflictDoNothing()
    .run();
  return db.select().from(users).where(eq(users.id, LOCAL_ID)).get()!;
}

/** Strips the password hash before a user ever reaches a response body. */
export function toPublicUser(user: User) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}
