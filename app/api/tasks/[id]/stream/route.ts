import { getCurrentUser } from "@/lib/auth";
import { findOwnedTask } from "@/lib/task-access";
import { RUNNER_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

// GET /api/tasks/:id/stream — authenticated SSE proxy to the runner daemon.
// The browser never talks to the runner directly; proxy.ts gates this route, and
// the runner stays loopback-only. `?after=<eventId>` is forwarded for replay.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // The runner streams for any id it's asked about, so this is where a transcript is kept
  // private: only the owner (a signed-in account, or the local workspace) gets the stream.
  // 404 rather than 403, so probing ids reveals nothing.
  const user = await getCurrentUser();
  if (!findOwnedTask(id, user.id)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const after = new URL(req.url).searchParams.get("after") ?? "0";
  let upstream: Response;
  try {
    upstream = await fetch(
      `${RUNNER_URL}/tasks/${encodeURIComponent(id)}/stream?after=${encodeURIComponent(after)}`,
      // Tie the upstream connection to the client's: when the browser closes the
      // EventSource, abort the runner fetch so it doesn't hold a dead stream open.
      { signal: req.signal, cache: "no-store" },
    );
  } catch {
    return Response.json({ error: "runner unreachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: "runner stream failed" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
