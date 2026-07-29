import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// POST /api/auth/signout — clear the session cookie and its DB row.
export async function POST(request: Request) {
  if (!rateLimit(`signout:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
  }

  await destroySession();
  return NextResponse.json({ ok: true });
}
