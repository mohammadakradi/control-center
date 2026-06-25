import { EventEmitter } from "node:events";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  agents,
  projects,
  taskEvents,
  tasks,
  type TaskStatus,
} from "../lib/db/schema";
import { GATE_PROMPT } from "./gate-prompt";
import {
  makeApprovalServer,
  type GateDecision,
  type GateKind,
} from "./approval-tool";
import { resolveModel, type ModelChoice } from "./model-router";

export type StreamEvent = {
  id?: number;
  type: string;
  payload: unknown;
  ts: number;
};

type SessionHandle = {
  taskId: string;
  out: EventEmitter; // SSE subscribers listen here
  pushInput: (m: SDKUserMessage) => void;
  closeInput: () => void;
  query: ReturnType<typeof query> | null;
  pendingApproval?: (decision: GateDecision) => void;
  done: boolean;
};

const sessions = new Map<string, SessionHandle>();

export const getHandle = (taskId: string) => sessions.get(taskId);

function makeInputChannel() {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const push = (m: SDKUserMessage) => {
    queue.push(m);
    wake?.();
    wake = null;
  };
  const close = () => {
    closed = true;
    wake?.();
    wake = null;
  };
  async function* gen(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (closed) return;
      await new Promise<void>((r) => (wake = r));
    }
  }
  return { push, close, gen };
}

function userMessage(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

function extractText(m: SDKMessage): string {
  const content = (m as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: "text"; text: string } => b?.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

function record(
  handle: SessionHandle,
  type: string,
  payload: unknown,
  persist = true,
): void {
  const ts = Date.now();
  if (!persist) {
    handle.out.emit("event", { type, payload, ts } satisfies StreamEvent);
    return;
  }
  const res = db
    .insert(taskEvents)
    .values({ taskId: handle.taskId, type: type as never, payload, ts: new Date(ts) })
    .run();
  handle.out.emit("event", {
    id: Number(res.lastInsertRowid),
    type,
    payload,
    ts,
  } satisfies StreamEvent);
}

function setStatus(handle: SessionHandle, status: TaskStatus): void {
  db.update(tasks).set({ status }).where(eq(tasks.id, handle.taskId)).run();
  record(handle, "status", { status });
}

function finalize(handle: SessionHandle, status: TaskStatus, error?: string): void {
  if (handle.done) return;
  handle.done = true;
  db.update(tasks)
    .set({ status, error: error ?? null, endedAt: new Date() })
    .where(eq(tasks.id, handle.taskId))
    .run();
  record(handle, "status", { status, error });
  record(handle, "end", { status });
  handle.closeInput();
}

const CONTINUE_PROMPT =
  "Continue the previous task — do NOT restart from scratch. First take stock of where you " +
  "left off: review your earlier work, the current git diff / working tree, `.swe/notes.md`, " +
  "and any relevant `.swe/epics/` entry. Then resume from the next incomplete step and carry " +
  "the workflow through to completion (build → review → report gate → commit).";

/** Start executing a task. Loads task/project/agent from the shared DB. */
export function startTask(taskId: string): SessionHandle {
  return runTask(taskId, false);
}

/** Resume a failed/cancelled task from where it left off (SDK session resume + a continuation prompt). */
export function continueTask(taskId: string): SessionHandle {
  return runTask(taskId, true);
}

function runTask(taskId: string, resume: boolean): SessionHandle {
  const existing = sessions.get(taskId);
  if (existing) return existing;

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw new Error(`task not found: ${taskId}`);
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .get();
  const agent = db.select().from(agents).where(eq(agents.id, task.agentId)).get();
  if (!project) throw new Error("project not found");
  if (!agent) throw new Error("agent not found");

  const channel = makeInputChannel();
  const out = new EventEmitter();
  out.setMaxListeners(50);
  const handle: SessionHandle = {
    taskId,
    out,
    pushInput: channel.push,
    closeInput: channel.close,
    query: null,
    done: false,
  };
  sessions.set(taskId, handle);

  const onGate = (gate: GateKind, summary: string): Promise<GateDecision> => {
    record(handle, "gate", { gate, summary });
    setStatus(handle, gate === "proposal" ? "awaiting_proposal" : "awaiting_report");
    return new Promise<GateDecision>((resolve) => {
      handle.pendingApproval = (decision) => {
        handle.pendingApproval = undefined;
        if (decision.allow) {
          setStatus(handle, gate === "proposal" ? "building" : "committing");
        }
        resolve(decision);
      };
    });
  };

  const canResume = resume && Boolean(task.sessionId);
  const prompt = resume
    ? CONTINUE_PROMPT
    : task.requestText
      ? `/${agent.namespace}:${task.command} ${task.requestText}`
      : `/${agent.namespace}:${task.command}`;

  if (resume) {
    db.update(tasks)
      .set({ error: null, endedAt: null })
      .where(eq(tasks.id, taskId))
      .run();
  }
  setStatus(handle, "running");
  record(handle, "log", {
    message: resume
      ? `Continuing task${canResume ? ` (resuming session ${task.sessionId!.slice(0, 8)})` : " (fresh session — inspecting working tree)"}`
      : `Dispatched: ${prompt}`,
  });

  // Resolve the model (triage for "auto"), start the session, consume the output stream.
  (async () => {
    try {
      // On resume, task.model is already a concrete label → resolveModel returns it as-is.
      const choice = (task.model as ModelChoice) || "auto";
      const chosen = await resolveModel(task.command, task.requestText, choice);
      db.update(tasks)
        .set({ model: chosen.label, modelReason: chosen.reason })
        .where(eq(tasks.id, taskId))
        .run();
      record(handle, "model", { model: chosen.label, reason: chosen.reason });
      record(handle, "log", {
        message: `🧠 Model: ${chosen.label} — ${chosen.reason}`,
      });

      const q = query({
        prompt: channel.gen(),
        options: {
          model: chosen.id,
          cwd: project.path,
          plugins: [{ type: "local", path: agent.sourcePath }],
          settingSources: ["user", "project", "local"],
          permissionMode: "bypassPermissions",
          systemPrompt: { type: "preset", preset: "claude_code", append: GATE_PROMPT },
          includePartialMessages: true,
          mcpServers: { "swe-platform": makeApprovalServer(onGate) },
          ...(canResume ? { resume: task.sessionId! } : {}),
        },
      });
      handle.query = q;
      channel.push(userMessage(prompt));

      for await (const m of q as AsyncIterable<SDKMessage>) {
        const sid = (m as { session_id?: string }).session_id;
        if (sid && !task.sessionId) {
          db.update(tasks).set({ sessionId: sid }).where(eq(tasks.id, taskId)).run();
          task.sessionId = sid;
        }

        if (m.type === "stream_event") {
          record(handle, "partial", m, false); // ephemeral token stream
          continue;
        }
        record(handle, "message", m);

        if (m.type === "assistant") {
          const text = extractText(m);
          if (text.includes("[[DONE]]")) finalize(handle, "done");
        }
        if (m.type === "result") {
          const sub = (m as { subtype?: string }).subtype ?? "";
          if (sub && sub !== "success" && !sub.startsWith("success")) {
            // a result subtype other than success usually means the run ended on an error
            record(handle, "log", { message: `result: ${sub}` });
          }
        }
      }
      finalize(handle, "done");
    } catch (err) {
      record(handle, "log", { message: `error: ${(err as Error).message}` });
      finalize(handle, "failed", (err as Error).message);
    } finally {
      // keep the handle briefly for late SSE flushes, then drop it
      setTimeout(() => sessions.delete(taskId), 60_000);
    }
  })();

  return handle;
}

/** Deliver a user decision/reply to a live task. */
export function respond(taskId: string, decision: GateDecision): boolean {
  const h = sessions.get(taskId);
  if (!h) return false;
  if (h.pendingApproval) {
    h.pendingApproval(decision);
  } else {
    // Fallback path: the agent ended its turn (prose gate) — push a conversational reply.
    h.pushInput(
      userMessage(
        decision.allow
          ? decision.feedback
            ? `Approved with changes: ${decision.feedback}. Proceed.`
            : "Approved. Proceed."
          : `Not approved. ${decision.feedback ?? "Please revise and present again."}`,
      ),
    );
    setStatus(h, "building");
  }
  return true;
}

/** Send a free-form chat reply into a live task (for plain questions). */
export function sendReply(taskId: string, text: string): boolean {
  const h = sessions.get(taskId);
  if (!h) return false;
  if (h.pendingApproval) {
    h.pendingApproval({ allow: true, feedback: text });
  } else {
    h.pushInput(userMessage(text));
  }
  return true;
}

/** Interrupt and cancel a running task. */
export async function stopTask(taskId: string): Promise<boolean> {
  const h = sessions.get(taskId);
  if (!h) return false;
  try {
    await h.query?.interrupt();
  } catch {
    /* ignore */
  }
  finalize(h, "cancelled");
  return true;
}
