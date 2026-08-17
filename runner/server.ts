import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, readdirSync } from "node:fs";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../lib/db";
import {
  projects,
  taskEvents,
  tasks,
  TERMINAL_TASK_STATUSES,
  type Attachment,
  type TaskStatus,
} from "../lib/db/schema";
import {
  removeOrphanWorktreeDir,
  removeWorktreeIfClean,
  taskWorktreeDir,
  WORKTREES_DIR,
} from "./worktree";
import { RUNNER_HOST, RUNNER_PORT } from "../lib/config";
import {
  continueTask,
  getHandle,
  respond,
  sendReply,
  startTask,
  stopTask,
  type StreamEvent,
} from "./session-manager";
import { usageSnapshot } from "./usage-snapshot";

// No CORS on purpose: the browser never calls the runner. Only the Next.js server
// does (same host), via the session-gated /api/tasks/[id]/* proxy routes.
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// Best-effort Claude plan rate limits for one user. The SDK session lives here, so the web
// app can't ask Anthropic directly. Never fails: an unavailable snapshot is a 200 with
// `available: false` and a reason (see ./usage-snapshot for why that's the normal answer).
app.get("/usage/:userId", async (c) => {
  return c.json(await usageSnapshot(c.req.param("userId")));
});

// Start executing a task (details loaded from the shared DB).
app.post("/tasks", async (c) => {
  const { taskId } = (await c.req.json()) as { taskId?: string };
  if (!taskId) return c.json({ error: "taskId required" }, 400);
  try {
    startTask(taskId);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Live event stream (SSE). `?after=<eventId>` replays persisted events past that id first.
app.get("/tasks/:id/stream", (c) => {
  const id = c.req.param("id");
  const after = Number(c.req.query("after") ?? 0);

  return streamSSE(c, async (stream) => {
    const live: StreamEvent[] = [];
    let wake: (() => void) | null = null;
    let aborted = false;
    const notify = () => {
      wake?.();
      wake = null;
    };
    stream.onAbort(() => {
      aborted = true;
      notify();
    });

    const handle = getHandle(id);
    // Attach the live listener BEFORE replay so nothing is missed; dedup by id below.
    const listener = (ev: StreamEvent) => {
      live.push(ev);
      notify();
    };
    handle?.out.on("event", listener);

    let lastSent = after;
    const send = async (ev: StreamEvent) => {
      await stream.writeSSE({
        data: JSON.stringify(ev),
        id: ev.id !== undefined ? String(ev.id) : undefined,
      });
      if (ev.id !== undefined) lastSent = ev.id;
    };

    // Replay persisted history.
    let sawEnd = false;
    const past = db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, id), gt(taskEvents.id, after)))
      .orderBy(asc(taskEvents.id))
      .all();
    for (const e of past) {
      if (e.type === ("end" as typeof e.type)) sawEnd = true;
      await send({
        id: e.id,
        type: e.type,
        payload: e.payload,
        ts: e.ts instanceof Date ? e.ts.getTime() : Number(e.ts),
      });
    }

    if (!handle) {
      // No live session: the run already ended (or was orphaned by a restart).
      // If the persisted history didn't carry a terminal event, synthesize one
      // from the authoritative DB status so a reconnecting client stops waiting.
      if (!sawEnd) {
        const t = db.select().from(tasks).where(eq(tasks.id, id)).get();
        if (t && TERMINAL_TASK_STATUSES.includes(t.status)) {
          const ts = Date.now();
          await send({ type: "status", payload: { status: t.status, error: t.error ?? undefined }, ts });
          await send({ type: "end", payload: { status: t.status }, ts });
        }
      }
      await stream.writeSSE({ event: "closed", data: "{}" });
      return;
    }

    try {
      while (!aborted) {
        while (live.length) {
          const ev = live.shift()!;
          if (ev.id !== undefined && ev.id <= lastSent) continue; // already replayed
          await send(ev);
          if (ev.type === "end") {
            aborted = true;
            break;
          }
        }
        if (aborted) break;
        await new Promise<void>((r) => (wake = r));
      }
    } finally {
      handle.out.off("event", listener);
    }
  });
});

// Approve / approve-with-changes / reject at a gate.
app.post("/tasks/:id/respond", async (c) => {
  const body = (await c.req.json()) as { allow?: boolean; feedback?: string };
  const ok = respond(c.req.param("id"), {
    allow: body.allow ?? false,
    feedback: body.feedback,
  });
  return c.json({ ok }, ok ? 200 : 404);
});

// Free-form reply (for plain questions outside a gate).
app.post("/tasks/:id/reply", async (c) => {
  const { text } = (await c.req.json()) as { text?: string };
  const ok = sendReply(c.req.param("id"), text ?? "");
  return c.json({ ok }, ok ? 200 : 404);
});

// Interrupt / cancel.
app.post("/tasks/:id/stop", async (c) => {
  const ok = await stopTask(c.req.param("id"));
  return c.json({ ok }, ok ? 200 : 404);
});

// Continue a task (failed/cancelled/done) — optionally with a user change request + files.
app.post("/tasks/:id/continue", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    message?: string;
    attachments?: Attachment[];
  };
  try {
    continueTask(
      c.req.param("id"),
      body.message?.trim() || undefined,
      body.attachments ?? [],
    );
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// On startup, any task still in a non-terminal state has lost its in-memory session — fail it cleanly.
const ACTIVE: TaskStatus[] = [
  "queued",
  "running",
  "awaiting_proposal",
  "building",
  "awaiting_report",
  "committing",
];
const orphaned = db
  .select({ id: tasks.id })
  .from(tasks)
  .where(inArray(tasks.status, ACTIVE))
  .all();
for (const { id } of orphaned) {
  const error = "Runner restarted while this task was active.";
  const ts = new Date();
  db.update(tasks)
    .set({ status: "failed", error, endedAt: ts })
    .where(eq(tasks.id, id))
    .run();
  // Append terminal events so any reconnecting client transitions out of "active".
  db.insert(taskEvents)
    .values({ taskId: id, type: "status" as never, payload: { status: "failed", error }, ts })
    .run();
  db.insert(taskEvents)
    .values({ taskId: id, type: "end" as never, payload: { status: "failed" }, ts })
    .run();
}

// Sweep task worktrees left behind by earlier runs. Deliberately conservative: a worktree
// belonging to a failed/cancelled task (including everything the reconciliation above just
// failed) is KEPT — the agent workflow holds all work uncommitted until its report gate, so
// that tree may be the only copy of real work, and Continue resumes straight into it. What
// goes: dirs with no task row at all (nothing can ever resume them, and with no row there's
// no project path to ask git — plain delete), and clean trees of tasks already `done`,
// whose end-of-run cleanup was skipped by a crash. Dirty `done` trees stay, same as at
// finalize.
let sweptWorktrees = 0;
try {
  for (const name of existsSync(WORKTREES_DIR) ? readdirSync(WORKTREES_DIR) : []) {
    try {
      const task = db
        .select({ id: tasks.id, status: tasks.status, projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, name))
        .get();
      if (!task) {
        removeOrphanWorktreeDir(name);
        sweptWorktrees += 1;
        continue;
      }
      if (task.status !== "done") continue;
      const project = db
        .select({ path: projects.path })
        .from(projects)
        .where(eq(projects.id, task.projectId))
        .get();
      if (project && removeWorktreeIfClean(project.path, taskWorktreeDir(name))) {
        sweptWorktrees += 1;
      }
    } catch {
      // One unsweepable entry (odd name, vanished repo) must not stop the others — or boot.
    }
  }
} catch {
  /* a missing/unreadable worktrees dir is not a reason to refuse to serve */
}

serve({ fetch: app.fetch, port: RUNNER_PORT, hostname: RUNNER_HOST }, (info) => {
  console.log(`[runner] listening on http://${RUNNER_HOST}:${info.port}`);
  if (orphaned.length > 0)
    console.log(`[runner] reconciled ${orphaned.length} orphaned task(s)`);
  if (sweptWorktrees > 0)
    console.log(`[runner] swept ${sweptWorktrees} stale task worktree(s)`);
});
