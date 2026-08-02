import { EventEmitter } from "node:events";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  agents,
  projects,
  taskEvents,
  tasks,
  type Attachment,
  type TaskStatus,
} from "../lib/db/schema";
import { GATE_PROMPT } from "./gate-prompt";
import {
  makeApprovalServer,
  type GateDecision,
  type GateKind,
} from "./approval-tool";
import { generateTitle, resolveModel, type ModelChoice } from "./model-router";
import { buildTaskEnv, sensitiveEnvValues, type TaskEnv } from "./user-env";
import {
  isZeroUsage,
  LAUNCH_LOG,
  usageDelta,
  usageIncrement,
  ZERO_USAGE,
  type UsageTotals,
} from "./usage";

export type StreamEvent = {
  id?: number;
  type: string;
  payload: unknown;
  ts: number;
};

type SessionHandle = {
  taskId: string;
  projectId: string; // for per-project serialization
  out: EventEmitter; // SSE subscribers listen here
  pushInput: (m: SDKUserMessage) => void;
  closeInput: () => void;
  query: ReturnType<typeof query> | null;
  pendingApproval?: (decision: GateDecision) => void;
  started: boolean; // false while queued behind another job on the same project
  start?: () => void; // launches the SDK session (set only while queued)
  done: boolean;
  /** Credential values injected into this task's subprocess env. Task transcripts are
   *  visible to every signed-in user, so any event that would echo one of these (e.g.
   *  the agent running `env` — deliberately or via prompt injection) is scrubbed
   *  before it is persisted or streamed. */
  secrets: string[];
};

const sessions = new Map<string, SessionHandle>();

export const getHandle = (taskId: string) => sessions.get(taskId);

/** Is another job actually running (started, not finished) in this project right now? */
function projectBusy(projectId: string, exceptTaskId?: string): boolean {
  for (const h of sessions.values()) {
    if (h.projectId === projectId && h.started && !h.done && h.taskId !== exceptTaskId)
      return true;
  }
  return false;
}

/**
 * When a project frees up, launch the oldest job still queued behind it.
 * No-ops if the project is still busy — so cancelling one queued job can't
 * accidentally start another while a job is mid-flight.
 */
function promoteNext(projectId: string): void {
  if (projectBusy(projectId)) return;
  const next = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, "queued")))
    .orderBy(asc(tasks.createdAt))
    .get();
  if (!next) return;
  const h = sessions.get(next.id);
  if (h?.start && !h.started) h.start();
  else if (!h) startTask(next.id); // no live handle (e.g. after restart) — dispatch fresh
}

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

/** Workflow markers are only meaningful as a trailing end-of-message signal —
 *  matching them anywhere would misfire when the agent quotes the marker in prose
 *  (e.g. "tasks that finish without `[[DONE]]`…"). */
const DONE_AT_END = /\[\[DONE\]\]\s*$/;
const GATE_AT_END = /\[\[GATE:(PROPOSAL|REPORT)\]\]\s*$/;

/** The agent sometimes ends a turn *mid-workflow* — e.g. right after dispatching
 *  its review/audit subagents — narrating that it will pick back up once they
 *  report. That is NOT completion: finalizing there synthesizes a bogus "done"
 *  and drops the real report/gate the agent produces next. This matches that
 *  "I'm waiting" phrasing so we can nudge the agent to continue instead. */
const WAITING_RE =
  /\b(standing by|will resume|report(?:ing)? back|wait(?:ing|s)? (?:for|on)|i'?ll (?:resume|continue|wait)|continue once|once (?:they|it|the)\b[^.]*\b(?:report|finish|complete|return|back)|running in the background|in the background\b[^.]*\b(?:wait|report|verdict|result|finish)|before the (?:report|proposal) gate|dispatch(?:ed|ing)\b[^.]*\b(?:review|audit|sub-?agents?|sub-?tasks?))/i;
/** Cap auto-continue nudges so a stuck agent can't loop forever. */
const MAX_AUTO_CONTINUE = 3;

/** True for messages from the main agent thread (subagent messages carry a
 *  parent_tool_use_id / subagent_type and must not drive task completion). */
function isMainThread(m: SDKMessage): boolean {
  const a = m as { parent_tool_use_id?: string | null; subagent_type?: string };
  return !a.parent_tool_use_id && !a.subagent_type;
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

const REDACTED = "[REDACTED_TOKEN]";

/** Replace any occurrence of the given secret values in `text`. */
export function redactString(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join(REDACTED);
  return out;
}

/** Scrub secret values anywhere inside an event payload (tool output, prose, errors).
 *  Works on the JSON serialization: tokens are plain ASCII (`sk-ant-…`), so they can't
 *  be altered by JSON string escaping. Returns the payload unchanged when clean. */
export function redactPayload(payload: unknown, secrets: string[]): unknown {
  if (secrets.length === 0) return payload;
  const json = JSON.stringify(payload);
  if (json === undefined || !secrets.some((s) => s && json.includes(s))) return payload;
  return JSON.parse(redactString(json, secrets));
}

function record(
  handle: SessionHandle,
  type: string,
  rawPayload: unknown,
  persist = true,
): void {
  // Single chokepoint for everything that reaches task_events or an SSE subscriber —
  // the owner's injected credential must never appear in either (transcripts are
  // visible to all signed-in users).
  const payload = redactPayload(rawPayload, handle.secrets);
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

function finalize(handle: SessionHandle, status: TaskStatus, rawError?: string): void {
  if (handle.done) return;
  handle.done = true;
  // The error column is user-visible too — scrub it like any event payload.
  const error = rawError ? redactString(rawError, handle.secrets) : rawError;
  db.update(tasks)
    .set({ status, error: error ?? null, endedAt: new Date() })
    .where(eq(tasks.id, handle.taskId))
    .run();
  record(handle, "status", { status, error });
  record(handle, "end", { status });
  handle.closeInput();
  // This project just freed up — start the next job waiting on it (if any).
  promoteNext(handle.projectId);
}

function continuePrompt(namespace: string): string {
  return (
    "Continue the previous task — do NOT restart from scratch. First take stock of where you " +
    "left off: review your earlier work, the current git diff / working tree, " +
    `\`.${namespace}/notes.md\`, and any relevant \`.${namespace}/epics/\` entry. Then resume ` +
    "from the next incomplete step and carry the workflow through to completion " +
    "(build → review → report gate → commit)."
  );
}

/** Resume prompt when the user reviewed the result and is asking for changes/follow-up. */
function changesPrompt(namespace: string, message: string): string {
  return (
    "The user reviewed your work on this task and is requesting changes / follow-up:\n\n" +
    `${message}\n\n` +
    "Continue the SAME task — do NOT start over. First re-orient: review your previous work, " +
    `the current git diff / working tree, \`.${namespace}/notes.md\`, and anything you already ` +
    "produced for this task. Then make the requested changes (updating, not duplicating, your " +
    "earlier output) and carry the workflow through its gates to completion. If the change is " +
    "out of scope for this task, say so plainly instead of guessing."
  );
}

/** Fallback title when there's no request text to summarize (e.g. onboard). */
export function defaultTitle(command: string, projectName: string): string {
  switch (command) {
    case "onboard":
      return `Onboard ${projectName}`;
    case "workspace":
      return `Set up the ${projectName} workspace`;
    case "review":
      return "Review the working changes";
    case "security":
      return "Security audit";
    case "audit":
      return "Frontend consistency audit";
    case "ship":
      return "Open a pull request";
    default:
      return `${command.charAt(0).toUpperCase()}${command.slice(1)} task`;
  }
}

/** Give the task a smart, human-readable name so history reads by intent, not by
 *  command. Fire-and-forget: best-effort, never blocks or fails the run. */
function nameTask(
  taskId: string,
  command: string,
  requestText: string,
  projectName: string,
  env: TaskEnv,
): void {
  void (async () => {
    try {
      const title =
        (await generateTitle(command, requestText, env)) ??
        defaultTitle(command, projectName);
      db.update(tasks).set({ title }).where(eq(tasks.id, taskId)).run();
    } catch {
      /* naming is best-effort */
    }
  })();
}

/** Start executing a task. Loads task/project/agent from the shared DB. */
export function startTask(taskId: string): SessionHandle {
  return runTask(taskId, false);
}

/**
 * Resume a task (failed/cancelled/done) in its existing SDK session. With no message it
 * picks up where it left off; with a message it applies the user's requested changes.
 */
export function continueTask(
  taskId: string,
  message?: string,
  attachments: Attachment[] = [],
): SessionHandle {
  return runTask(taskId, true, message, attachments);
}

function runTask(
  taskId: string,
  resume: boolean,
  changeMessage?: string,
  extraAttachments: Attachment[] = [],
): SessionHandle {
  const existing = sessions.get(taskId);
  if (existing && !existing.done) return existing; // already live (running or queued)
  if (existing) sessions.delete(taskId); // a finished handle still lingering — replace it

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

  // Resolve the owner's credential BEFORE creating a handle: every SDK session this
  // task opens (triage, title, the run itself) bills the owner's token, and a missing
  // token must fail the dispatch with a clear error, not a dead session. The decrypted
  // env stays in this closure — never in the DB, task events, or logs. (Re-resolved
  // again at launch: a queued task must not run on a token snapshot the owner has
  // since replaced or cleared.)
  const taskEnv = buildTaskEnv(task.userId);

  const channel = makeInputChannel();
  const out = new EventEmitter();
  out.setMaxListeners(50);
  const handle: SessionHandle = {
    taskId,
    projectId: project.id,
    out,
    pushInput: channel.push,
    closeInput: channel.close,
    query: null,
    started: false,
    done: false,
    secrets: sensitiveEnvValues(taskEnv),
  };
  sessions.set(taskId, handle);

  // The actual run: resolve the model, open the SDK session, consume the stream.
  // Wrapped in `launch` so the job can sit queued until its project frees up.
  const launch = () => {
    if (handle.started || handle.done) return;
    handle.started = true;
    handle.start = undefined;

    // Re-resolve the credential now that the task actually starts — it may have sat
    // queued while the owner replaced or cleared their token in Settings.
    let env: TaskEnv;
    try {
      env = buildTaskEnv(task.userId);
    } catch (err) {
      finalize(handle, "failed", (err as Error).message);
      return;
    }
    handle.secrets = sensitiveEnvValues(env);

    // Name the task for readable history (fire-and-forget; never blocks the run).
    if (!resume && !task.title) {
      nameTask(taskId, task.command, task.requestText, project.name, env);
    }

  // Whether the run has surfaced a report the user can see (report gate or a
  // [[DONE]] summary). If not, we synthesize one from the final message at the end.
  let producedReport = false;
  // How many times we've nudged the agent to continue after it paused mid-workflow.
  let autoContinues = 0;
  // Cumulative token/cost counters last seen from THIS subprocess. Starts at zero for
  // every launch, because a continue/resume gets a fresh subprocess whose counters
  // restart while the task row keeps accumulating (see ./usage).
  let seenUsage: UsageTotals = { ...ZERO_USAGE };

  const onGate = (gate: GateKind, summary: string): Promise<GateDecision> => {
    if (gate === "report") producedReport = true;
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
  // Files/photos to point the agent at so it Reads them (Read renders images visually and
  // parses PDFs/docs). On the initial run that's the request's attachments; on a follow-up
  // it's the files added with the change request.
  const attachSet = resume
    ? extraAttachments
    : ((task.attachments ?? []) as Attachment[]);
  const attachNote = attachSet.length
    ? `\n\nThe user attached ${attachSet.length} file(s)${resume ? " with this follow-up" : " to this request"}. Read each with the Read tool before acting on it (images render visually; PDFs and docs are parsed):\n` +
      attachSet
        .map((a) => `- ${a.path}  (${a.type}, ${Math.round(a.size / 1024)} KB)`)
        .join("\n")
    : "";
  const resumePrompt = changeMessage
    ? changesPrompt(agent.namespace, changeMessage)
    : extraAttachments.length
      ? `The user added file(s) to this task and wants you to continue. Read the attached file(s) below, then continue the SAME task — update your earlier work as needed, don't restart.`
      : continuePrompt(agent.namespace);
  const prompt =
    (resume
      ? resumePrompt
      : task.requestText
        ? `/${agent.namespace}:${task.command} ${task.requestText}`
        : `/${agent.namespace}:${task.command}`) + attachNote;

  if (resume) {
    db.update(tasks)
      .set({ error: null, endedAt: null })
      .where(eq(tasks.id, taskId))
      .run();
  }
  setStatus(handle, "running");
  // Show the user's change request as a chat bubble so the transcript reflects the ask.
  if (resume && (changeMessage || extraAttachments.length)) {
    const filesNote = extraAttachments.length
      ? ` (+${extraAttachments.length} file${extraAttachments.length === 1 ? "" : "s"})`
      : "";
    record(handle, "message", {
      type: "user",
      message: {
        role: "user",
        content: `✏️ Requested changes: ${changeMessage ?? "(see attached files)"}${filesNote}`,
      },
    });
  }
  // Built from LAUNCH_LOG so `usageFromEvents` can still find subprocess boundaries when
  // replaying history — rewording these freely would silently break usage backfill.
  record(handle, "log", {
    message: resume
      ? changeMessage
        ? `${LAUNCH_LOG.continuing} with requested changes${canResume ? ` (resuming session ${task.sessionId!.slice(0, 8)})` : " (fresh session)"}`
        : `${LAUNCH_LOG.continuing} task${canResume ? ` (resuming session ${task.sessionId!.slice(0, 8)})` : " (fresh session — inspecting working tree)"}`
      : `${LAUNCH_LOG.dispatched} ${prompt}`,
  });

  // Resolve the model (triage for "auto"), start the session, consume the output stream.
  (async () => {
    try {
      // On resume, task.model is already a concrete label → resolveModel returns it as-is.
      const choice = (task.model as ModelChoice) || "auto";
      const chosen = await resolveModel(
        agent.namespace,
        task.command,
        task.requestText,
        choice,
        env,
      );
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
          env, // owner's token; replaces process.env (see buildTaskEnv)
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

      let lastAssistantText = "";
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

        if (m.type === "assistant" && isMainThread(m)) {
          const text = extractText(m);
          if (text.trim()) lastAssistantText = text;
          if (DONE_AT_END.test(text)) {
            producedReport = true;
            finalize(handle, "done");
          }
        }
        // A `result` message marks the end of a turn. In streaming-input mode the
        // SDK then waits for more input, so the message loop never ends on its own —
        // we must decide here whether the task is complete. (Without this, commands
        // that finish without printing [[DONE]] — e.g. onboard — hang in "running".)
        if (m.type === "result") {
          // Bank what this turn consumed BEFORE deciding the task's fate: a failed or
          // cancelled run still spent real tokens, and its result message carries them.
          // The counters are cumulative per subprocess, so we add the delta — which is
          // what makes a continue/resume accumulate onto the task's earlier runs
          // instead of overwriting them. Accounting must never break a run.
          try {
            const { delta, next } = usageDelta(seenUsage, m);
            if (!isZeroUsage(delta)) {
              db.update(tasks)
                .set(usageIncrement(delta))
                .where(eq(tasks.id, taskId))
                .run();
            }
            // Advance the snapshot only once the write has landed: if it threw, this
            // turn's usage stays folded into the next delta, so a transient DB error
            // self-heals instead of silently losing the spend.
            seenUsage = next;
          } catch (err) {
            record(handle, "log", {
              message: `usage accounting skipped: ${(err as Error).message}`,
            });
          }

          const sub = (m as { subtype?: string }).subtype ?? "";
          // The SDK reports some hard failures (e.g. an invalid Anthropic token →
          // 401) as subtype "success" with is_error: true — treat those as failed
          // too, so a bad credential doesn't masquerade as a completed task.
          const isErr = (m as { is_error?: boolean }).is_error === true;
          if (sub !== "success" || isErr) {
            // error_during_execution / error_max_turns / error_max_budget_usd / …
            const detail = (m as { result?: string }).result;
            finalize(
              handle,
              "failed",
              (isErr && detail) || `run ended: ${sub || "unknown error"}`,
            );
          } else if (!handle.done) {
            const gate = lastAssistantText.match(GATE_AT_END);
            if (handle.pendingApproval) {
              // A tool-based gate is awaiting the user — keep the session alive.
            } else if (gate) {
              // Prose-gate fallback: the agent signalled a gate via the marker
              // instead of the approval tool. Surface it so it stays actionable
              // (respond() pushes the decision back as a reply) rather than stuck.
              const kind = gate[1] === "PROPOSAL" ? "proposal" : "report";
              const summary = lastAssistantText
                .replace(/\[\[(DONE|GATE:[A-Z]+)\]\]/g, "")
                .trim();
              record(handle, "gate", { gate: kind, summary });
              setStatus(
                handle,
                kind === "proposal" ? "awaiting_proposal" : "awaiting_report",
              );
            } else if (
              !producedReport &&
              autoContinues < MAX_AUTO_CONTINUE &&
              WAITING_RE.test(lastAssistantText)
            ) {
              // The agent ended the turn mid-workflow (e.g. it dispatched review
              // subagents and said it would resume). It isn't done — nudge it to
              // continue rather than finalizing and dropping the real report/gate
              // it still owes us.
              autoContinues += 1;
              record(handle, "log", {
                message:
                  "Agent paused mid-workflow; nudging it to finish (continue → report gate).",
              });
              handle.pushInput(
                userMessage(
                  "Your dispatched sub-tasks/reviews have completed and their results are " +
                    "above. Do NOT stop here — continue this SAME task: incorporate the " +
                    "findings and carry the workflow through to its report gate by calling " +
                    'the request_approval tool with { gate: "report", summary: <plain-language ' +
                    "report> }. Only print [[DONE]] once the task is genuinely complete.",
                ),
              );
            } else {
              // Turn ended with nothing pending → the task is complete. If the run
              // produced no report (e.g. onboard, which prints a plain summary with
              // no [[DONE]] and no report gate), surface that summary as the report
              // so the user sees a result rather than an empty/activity-only view.
              if (!producedReport && lastAssistantText.trim()) {
                record(handle, "message", {
                  type: "assistant",
                  message: {
                    content: [
                      { type: "text", text: `${lastAssistantText.trim()}\n\n[[DONE]]` },
                    ],
                  },
                });
                producedReport = true;
              }
              finalize(handle, "done");
            }
          }
        }
      }
      finalize(handle, "done");
    } catch (err) {
      record(handle, "log", { message: `error: ${(err as Error).message}` });
      finalize(handle, "failed", (err as Error).message);
    } finally {
      // keep the handle briefly for late SSE flushes, then drop it — but only if it
      // hasn't been replaced by a re-dispatch of the same task in the meantime.
      setTimeout(() => {
        if (sessions.get(taskId) === handle) sessions.delete(taskId);
      }, 60_000);
    }
    })();
  };

  // Serialize per project: at most one live job per project. If another job is
  // running here, queue this one — finalize() promotes it when the project frees.
  if (projectBusy(project.id, taskId)) {
    handle.start = launch;
    setStatus(handle, "queued");
    record(handle, "log", {
      message: "Queued — waiting for another job on this project to finish.",
    });
    return handle;
  }

  launch();
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
