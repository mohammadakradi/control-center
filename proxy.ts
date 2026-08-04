import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (functionality unchanged).
const PUBLIC_PAGES = new Set(["/signin", "/signup"]);

// Reachable signed out: Chrome fetches the manifest to decide whether the app is installable,
// and a redirect to /signin turns it into HTML, which makes the app un-installable. It carries
// no user data. The icons it points at are `.png`s under /icons/, already skipped by the
// matcher below — this route is listed because it has no file extension.
const PUBLIC_METADATA = new Set(["/manifest.webmanifest"]);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // Fail closed: an uncaught throw here would propagate out of the middleware,
  // and Next serves the request anyway on a middleware exception — so a DB
  // hiccup while checking the session must not silently bypass auth.
  let user;
  try {
    user = token ? verifySessionToken(token) : null;
  } catch {
    user = null;
  }

  // The auth API itself (signin/signup/signout) must stay reachable while signed out.
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (PUBLIC_METADATA.has(pathname)) return NextResponse.next();

  if (PUBLIC_PAGES.has(pathname)) {
    // A signed-in visitor landing on /signin or /signup belongs at the dashboard instead.
    return user ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
