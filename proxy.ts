import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (functionality unchanged).
//
// Sign-in is OPTIONAL. Nothing here gates access any more: a visitor without a session is the
// local workspace (see `getCurrentUser`), which owns its own tasks and its own Anthropic token.
// Signing in switches to a private workspace instead of unlocking the app.
//
// What's left for this proxy is the one thing it still owes: keeping a signed-in visitor off the
// sign-in pages. Per-owner data separation is enforced where the data is read, not here — a
// middleware that waved requests through while pages queried unscoped rows would look like
// security and provide none.
const AUTH_PAGES = new Set(["/signin", "/signup"]);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!AUTH_PAGES.has(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // Fail closed the harmless way: if the session lookup throws (a DB hiccup), treat the visitor
  // as signed out and let them see the sign-in page.
  let signedIn = false;
  try {
    signedIn = token ? verifySessionToken(token) !== null : false;
  } catch {
    signedIn = false;
  }

  // Already signed in? The sign-in and sign-up pages have nothing to offer.
  return signedIn ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
}

export const config = {
  matcher: ["/signin", "/signup"],
};
