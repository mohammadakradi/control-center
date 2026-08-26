import { EventEmitter } from "node:events";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  agents,
  features,
  projects,
  taskEvents,
  tasks,
  type Attachment,
  type Feature,
  type TaskStatus,
} from "../lib/db/schema";
import { attachmentNote } from "../lib/uploads";
import {
  AUTO_COMPACT_WINDOW,
  MIN_LAUNCH_BUDGET_USD,
  TASK_MAX_BUDGET_USD,
  TASK_MAX_TURNS,
  remainingTaskBudgetUsd,
} from "../lib/config";
import { classifyTurnEnd, type PauseReason } from "./completion";
import { GATE_PROMPT } from "./gate-prompt";
import {
  makePlatformServer,
  type GateDecision,
  type GateKind,
} from "./platform-mcp";
import {
  generateTitle,
  resolveEffort,
  resolveModel,
  type ModelChoice,
} from "./model-router";
import { buildTaskEnv, sensitiveEnvValues, type TaskEnv } from "./user-env";
import {
  ensureFeatureBranch,
  ensureTaskWorktree,
  launchMode,
  mergeFeatureTask,
  removeWorktreeIfClean,
  worktreeBranch,
  worktreeDirty,
} from "./worktree";
import { sweepFeatureMerges } from "./merge-sweep";
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
  /** Set when this run executes in an isolated git worktree (parallel opt-in, or the
   *  resume of a run that was isolated). An isolated session doesn't occupy the project's
   *  main checkout, so `projectBusy` ignores it; `finalize` cleans the tree up on done. */
  worktree?: { projectPath: string; dir: string };
  /** The feature this task belongs to (tasks.featureId), captured once at dispatch. Drives
   *  the isolate-vs-run decision, the dispatched preamble for a non-isolated run, and the
   *  merge-on-done step in `finalize` — all read this rather than the row, which nothing
   *  here ever re-fetches mid-run. */
  featureId: string | null;
  /** Set once the one automatic conflict-resolution turn has been pushed (see `mergeOnDone`).
   *  Whatever that turn achieves, there is never a second one — the bound that keeps a merge
   *  the agent can't resolve from looping the session forever. */
  mergeResolveAttempted?: boolean;
  /** Set when the resolve turn was pushed *mid-turn* (the agent's [[DONE]] text finalizes
   *  before its own `result` message arrives). The next `result` then belongs to the turn
   *  that already ended, not to the resolve turn — the result handler must swallow it, or it
   *  would re-attempt the merge before the agent has even seen the resolve prompt and seal
   *  the task as `conflict` with the resolution still in flight. */
  mergeResolveSwallowResult?: boolean;
};

/** A feature row by id, or null if it's gone (deleted mid-run — its FK is `set null`, so a
 *  stale `featureId` on the task can outlive the row briefly). Every feature-aware step below
 *  treats a missing row as "nothing to do" rather than an error: the run itself still owes a
 *  result either way. */
function getFeature(featureId: string): Feature | null {
  return db.select().from(features).where(eq(features.id, featureId)).get() ?? null;
}

/** Told to a non-isolated (checkout) run linked to a feature, on every launch — the platform
 *  cannot merge this run's work for it (see `launchMode`'s `feature` docstring), so the
 *  guarantee that its work ends up on the feature branch is instruction-level only. Returns
 *  "" when the feature row is gone, so the preamble degrades to silence rather than naming a
 *  branch that no longer means anything. */
export function featureBranchPreamble(featureId: string): string {
  const feature = getFeature(featureId);
  if (!feature) return "";
  return (
    `\n\n⚠️ This task belongs to feature "${feature.name}" — do your work on git branch ` +
    `\`${feature.branch}\` (create it off the project's default branch if it doesn't exist ` +
    "yet, or switch to it if it does, and commit there). This run is not isolated, so the " +
    "platform will not merge your work into the feature branch automatically — leaving it " +
    "there is on you."
  );
}

const sessions = new Map<string, SessionHandle>();

export const getHandle = (taskId: string) => sessions.get(taskId);

/** Is another job actually running (started, not finished) in this project's main checkout
 *  right now? Worktree-isolated sessions don't count: they hold their own working tree, so
 *  they neither block the checkout nor stop `promoteNext` from filling it. */
function projectBusy(projectId: string, exceptTaskId?: string): boolean {
  for (const h of sessions.values()) {
    if (
      h.projectId === projectId &&
      h.started &&
      !h.done &&
      !h.worktree &&
      h.taskId !== exceptTaskId
    )
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
  // The checkout is free right now — settle any feature merges that were blocked on it
  // (and reclassify rows an earlier failure mis-recorded), before a promoted job takes it.
  try {
    sweepFeatureMerges(projectId, { mergeInMainCheckout: true });
  } catch {
    /* best-effort — a sweep failure must never stop the queue */
  }
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

/** Cap auto-continue nudges so a stuck agent can't loop forever. */
const MAX_AUTO_CONTINUE = 3;

/** What to send when a turn ended without the agent being finished (see ./completion). */
function nudgePrompt(reason: PauseReason): string {
  const carryOn =
    "Do NOT stop here and do NOT restart: continue this SAME task from where you left " +
    "off and carry the workflow through to its report gate by calling the " +
    'request_approval tool with { gate: "report", summary: <plain-language report> }. ' +
    "Only print [[DONE]] once the task is genuinely complete.";
  if (reason === "waiting")
    return (
      "Your dispatched sub-tasks/reviews have completed and their results are above. " +
      `Incorporate the findings. ${carryOn}`
    );
  return (
    "Your turn ended without a result: the last thing you said announced what you were " +
    "about to do (or said nothing at all) rather than reporting what you did, and no " +
    `report gate or [[DONE]] was produced — so the work is not finished. ${carryOn}`
  );
}

/**
 * What to do with a turn-ending `result` message, given the run's state. Pure and exported
 * so the ordering can be unit-tested — the loop that consumes it can't be (it needs a live
 * SDK `query`), but this is where the load-bearing precedence lives.
 *
 * **`"swallow"` comes first, before `"fail"`, and that ordering is the fix for a real bug**
 * (correctness review, 2026-08-22): after a mid-turn `[[DONE]]` triggers the merge step and
 * pushes the conflict-resolve turn, the *next* result is that same ended turn's own — stale,
 * to be eaten. If it happens to carry an error subtype (`error_max_turns`/`_max_budget_usd`,
 * plausible exactly when a turn both finishes its text and trips a limit), letting the error
 * branch win would seal the task `failed` and orphan the just-pushed resolve turn. Swallowing
 * regardless of subtype lets the resolve turn run; if it can't, the post-loop finalize is the
 * backstop.
 */
export type ResultAction =
  | "swallow"
  | "fail"
  | "none"
  | "await"
  | "gate"
  | "nudge"
  | "pause-fail"
  | "complete";
export function resultAction(s: {
  /** handle.mergeResolveSwallowResult — this stale result must be eaten whatever it says. */
  swallow: boolean;
  /** subtype !== "success" || is_error — a hard failure. */
  isError: boolean;
  /** handle.done — already finalized (e.g. a mid-turn [[DONE]] sealed it). */
  done: boolean;
  /** A tool-based gate is awaiting the user. */
  pendingApproval: boolean;
  /** A prose gate marker closed the last assistant message. */
  hasGate: boolean;
  /** The turn ended mid-workflow (narration / waiting), not on a real result. */
  paused: boolean;
  /** Nudge budget remains (autoContinues < MAX_AUTO_CONTINUE). */
  canNudge: boolean;
}): ResultAction {
  if (s.swallow) return "swallow";
  if (s.isError) return "fail";
  if (s.done) return "none";
  if (s.pendingApproval) return "await";
  if (s.hasGate) return "gate";
  if (s.paused) return s.canNudge ? "nudge" : "pause-fail";
  return "complete";
}

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

/** How a `finalize(…, "done")` call may react to a merge conflict: by pushing the one
 *  automatic resolve turn ("mid-turn" / "boundary" — see `mergeOnDone` for why the two
 *  differ), or not at all ("none": the input channel is closed or closing, so a pushed turn
 *  could never run). The default is "none" so a future finalize call site can't start an
 *  agent turn by accident. */
type MergeResolveContext = "mid-turn" | "boundary" | "none";

function finalize(
  handle: SessionHandle,
  status: TaskStatus,
  rawError?: string,
  opts: { resolve?: MergeResolveContext } = {},
): void {
  if (handle.done) return;
  // A feature-linked isolated run merges back into its feature branch *before* the task is
  // sealed, because a real content conflict gets one shot at being resolved by the still-live
  // session — in which case the task is not done yet: the resolve turn runs, and finalize is
  // reached again after it (every path back here re-attempts the merge exactly once more).
  if (status === "done" && handle.worktree && handle.featureId) {
    if (!mergeOnDone(handle, opts.resolve ?? "none")) return;
  }
  handle.done = true;
  // The error column is user-visible too — scrub it like any event payload.
  const error = rawError ? redactString(rawError, handle.secrets) : rawError;
  db.update(tasks)
    .set({ status, error: error ?? null, endedAt: new Date() })
    .where(eq(tasks.id, handle.taskId))
    .run();
  record(handle, "status", { status, error });
  // An isolated run that finished cleanly gives its worktree back — commits live on the
  // branch, so a *clean* tree carries nothing. A dirty tree (or any failed/cancelled run,
  // whose whole working state may be uncommitted) is kept so Continue can pick it up.
  if (handle.worktree && status === "done") {
    try {
      // The agent may have switched branches mid-run; record where the commits actually
      // are before the tree goes away — the file view's `git show` fallback reads this.
      // (`mergeOnDone` above already recorded it too; a fresh read here costs nothing and
      // stays correct for a done path that skipped the merge, e.g. a deleted feature.)
      const branch = worktreeBranch(handle.worktree.dir);
      if (branch) {
        db.update(tasks).set({ branch }).where(eq(tasks.id, handle.taskId)).run();
      }
      const removed = removeWorktreeIfClean(handle.worktree.projectPath, handle.worktree.dir);
      record(handle, "log", {
        message: removed
          ? `🧹 Cleaned up the isolated worktree — branch ${branch ?? "?"} keeps the commits.`
          : "Isolated worktree kept: it still holds uncommitted changes.",
      });
    } catch {
      /* cleanup must never fail a finished task */
    }
  }
  record(handle, "end", { status });
  handle.closeInput();
  // This project just freed up — start the next job waiting on it (if any).
  promoteNext(handle.projectId);
}

/** The one automatic turn a run gets to resolve its own merge conflict, in its own worktree.
 *  Both interpolations are safe in agent-facing text: the branch is an allowlisted slug and
 *  the name was reduced to one control-character-free line at creation (`cleanFeatureName`) —
 *  same stance as `featureBranchPreamble`. Exported only for its spec, like the preamble. */
export function mergeResolvePrompt(featureName: string, featureBranch: string): string {
  return (
    "Your work on this task is finished, but merging your branch into the feature branch " +
    `\`${featureBranch}\` (feature "${featureName}") hit a real merge conflict with work ` +
    "that is already on it from another run. Resolve it now, here in your own worktree:\n" +
    `1. Run \`git merge ${featureBranch}\`.\n` +
    "2. Resolve every conflict by reconciling BOTH sides' intent. Never discard the other " +
    "run's changes and never discard your own — integrate them.\n" +
    "3. Stage the resolutions and commit the merge.\n" +
    "4. If the project has a cheap check (typecheck, lint, the affected tests), run it on " +
    "the resolved files.\n" +
    "Then reply with one short line describing how you resolved it and end with [[DONE]]. " +
    "Do not open an approval gate for this, do not push, and do not start any new work — " +
    "once your branch contains the resolution, the platform merges it into the feature " +
    "branch itself."
  );
}

/**
 * Merge a finishing isolated task's branch into its feature branch, recording the outcome on
 * the task row (`mergeState`) and in the transcript. Returns whether finalize may proceed:
 * false means a resolve turn was pushed and the session continues — the task is not done yet.
 *
 * Never throws — a merge failure is a fact about the work, not a reason to fail bookkeeping.
 * The outcome is recorded *before* the resolve turn is pushed, so a run cancelled or crashed
 * mid-resolution keeps the honest `conflict` state rather than a stale `pending`.
 *
 * The `resolve` context exists because the two ways a run reaches "done" sit differently in
 * the turn lifecycle (see `MergeResolveContext`): after a mid-turn [[DONE]], the ending
 * turn's own `result` message is still in flight and must be swallowed
 * (`mergeResolveSwallowResult`); at a turn boundary the next `result` already belongs to the
 * resolve turn and is handled normally.
 */
function mergeOnDone(handle: SessionHandle, resolve: MergeResolveContext): boolean {
  if (!handle.worktree) return true;
  try {
    const branch = worktreeBranch(handle.worktree.dir);
    if (!branch) return true; // detached HEAD — nothing safely mergeable
    db.update(tasks).set({ branch }).where(eq(tasks.id, handle.taskId)).run();
    const feature = handle.featureId ? getFeature(handle.featureId) : null;
    if (!feature) return true; // deleted mid-run; nothing left to merge into
    const outcome = mergeFeatureTask(handle.worktree.projectPath, feature.branch, branch, {
      // The merge may run in the project's main checkout when that is where the feature
      // branch is checked out — but only while no session is live there. This run itself is
      // isolated, so it never holds the checkout.
      mergeInMainCheckout: !projectBusy(handle.projectId, handle.taskId),
    });
    db.update(tasks)
      .set({ mergeState: outcome.state })
      .where(eq(tasks.id, handle.taskId))
      .run();
    if (
      outcome.state === "conflict" &&
      resolve !== "none" &&
      !handle.mergeResolveAttempted
    ) {
      handle.mergeResolveAttempted = true;
      record(handle, "log", {
        message:
          `⚠️ Merging ${branch} into ${feature.branch} hit a real conflict — asking the ` +
          "agent to resolve it in its worktree (one attempt), then retrying the merge.",
      });
      handle.pushInput(userMessage(mergeResolvePrompt(feature.name, feature.branch)));
      if (resolve === "mid-turn") handle.mergeResolveSwallowResult = true;
      return false;
    }
    record(handle, "log", { message: mergeOutcomeLog(outcome, branch, feature.branch, handle) });
    return true;
  } catch (err) {
    record(handle, "log", {
      message: `merge step skipped: ${(err as Error).message}`,
    });
    return true;
  }
}

function mergeOutcomeLog(
  outcome: { state: string; output: string },
  branch: string,
  featureBranch: string,
  handle: SessionHandle,
): string {
  switch (outcome.state) {
    case "merged":
      return `🔀 Merged ${branch} into ${featureBranch}.`;
    case "no_commits":
      return (
        `Nothing to merge into ${featureBranch}: ${branch} has no commits of its own.` +
        (handle.worktree && worktreeDirty(handle.worktree.dir)
          ? " The run's uncommitted work is kept in its worktree — continue the task to commit it."
          : "")
      );
    case "blocked":
      return (
        `⏸ Merge into ${featureBranch} deferred — it will be retried automatically when the ` +
        `project frees up: ${outcome.output}`
      );
    default:
      return (
        `⚠️ Couldn't merge ${branch} into ${featureBranch} — left for manual resolution ` +
        `(both branches are intact):\n${outcome.output}`
      );
  }
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
    featureId: task.featureId,
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
  const attachNote = attachmentNote(
    attachSet,
    resume ? "with this follow-up" : "to this request",
  );
  const resumePrompt = changeMessage
    ? changesPrompt(agent.namespace, changeMessage)
    : extraAttachments.length
      ? `The user added file(s) to this task and wants you to continue. Read the attached file(s) below, then continue the SAME task — update your earlier work as needed, don't restart.`
      : continuePrompt(agent.namespace);
  // A non-isolated feature run is agent-owned git — the platform never merges it (see
  // `launchMode`'s `feature` docstring) — so the guarantee that its work lands on the
  // feature branch is this preamble, resent on every launch (fresh dispatch, continue, and
  // resume alike) since a new subprocess remembers nothing of an earlier one's instructions.
  // `handle.worktree` is authoritative here: it's set (or not) by the isolate/queue/run
  // branch below before `launch` ever runs, including the deferred "queue" case.
  const featurePreamble =
    !handle.worktree && task.featureId ? featureBranchPreamble(task.featureId) : "";
  const prompt =
    (resume
      ? resumePrompt
      : task.requestText
        ? `/${agent.namespace}:${task.command} ${task.requestText}`
        : `/${agent.namespace}:${task.command}`) +
    attachNote +
    featurePreamble;

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

  // What this launch may still spend. Computed from the row, so it is a *task* ceiling that
  // survives continues rather than a fresh allowance per subprocess (see lib/config.ts).
  const budgetLeft = remainingTaskBudgetUsd(task.usageCostUsd ?? 0);
  if (budgetLeft !== null && budgetLeft <= MIN_LAUNCH_BUDGET_USD) {
    // Refused rather than started: a session handed a few cents dies inside its first tool
    // call, which reads to the user as a crash instead of a cap. Says the number and the way
    // out, because otherwise this is indistinguishable from the app being broken.
    finalize(
      handle,
      "failed",
      `Task budget exhausted — $${(task.usageCostUsd ?? 0).toFixed(2)} spent of the ` +
        `$${TASK_MAX_BUDGET_USD.toFixed(2)} per-task cap. Raise CC_TASK_MAX_BUDGET_USD (or set ` +
        `it to 0 for no cap) and continue this task, or dispatch a fresh one.`,
    );
    return;
  }

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
      // Effort reuses the tier the model triage already classified (see resolveEffort), so
      // this costs no extra round-trip. On resume `task.effort` is already concrete.
      const effort = resolveEffort(task.command, task.effort || "auto", chosen.reason);
      db.update(tasks)
        .set({
          model: chosen.label,
          modelReason: chosen.reason,
          effort: effort.level,
          effortReason: effort.reason,
        })
        .where(eq(tasks.id, taskId))
        .run();
      record(handle, "model", {
        model: chosen.label,
        reason: chosen.reason,
        effort: effort.level,
        effortReason: effort.reason,
      });
      record(handle, "log", {
        message: `🧠 Model: ${chosen.label} — ${chosen.reason} · effort ${effort.level} (${effort.reason})`,
      });

      const q = query({
        prompt: channel.gen(),
        options: {
          model: chosen.id,
          // How hard the agent reasons, and how much it does per turn. Lower effort produces
          // fewer, more consolidated tool calls — a shorter transcript, which is where the
          // cost actually is (lib/models.ts).
          effort: effort.level,
          // Runaway guards. The SDK ends the query with `error_max_turns` /
          // `error_max_budget_usd`, which the stream loop below already turns into a failed
          // task carrying the reason. Spread conditionally so "no cap" omits the key rather
          // than passing 0, which the SDK would read as a real (and instantly exceeded) limit.
          ...(TASK_MAX_TURNS > 0 ? { maxTurns: TASK_MAX_TURNS } : {}),
          ...(budgetLeft !== null ? { maxBudgetUsd: budgetLeft } : {}),
          // An isolated run executes in its own worktree — but only one this process just
          // ensured exists (handle.worktree), never a stale `workdir` column alone.
          cwd: handle.worktree?.dir ?? project.path,
          env, // owner's token; replaces process.env (see buildTaskEnv)
          plugins: [{ type: "local", path: agent.sourcePath }],
          settingSources: ["user", "project", "local"],
          // Applies to every task whatever project it runs against — the "flag settings"
          // layer, which outranks the project's own settings.json. Only the compaction
          // window is set here: the rest of the user's settings must keep working.
          ...(AUTO_COMPACT_WINDOW > 0
            ? { settings: { autoCompactWindow: AUTO_COMPACT_WINDOW } }
            : {}),
          permissionMode: "bypassPermissions",
          systemPrompt: { type: "preset", preset: "claude_code", append: GATE_PROMPT },
          includePartialMessages: true,
          mcpServers: {
            "swe-platform": makePlatformServer({
              onGate,
              backlog: {
                // Taken from the task's own row, never from the agent's arguments: backlogs
                // are shared install-wide, so a project id an agent could supply would let
                // one session file work into another project's list.
                projectId: project.id,
                // Through `record`, so an item filed mid-task shows up in the transcript
                // (and is redaction-scrubbed) like everything else the run did.
                onLog: (message) => record(handle, "log", { message }),
                // The row itself doesn't go through `record`, and it lands somewhere wider
                // than a transcript — every workspace can read a backlog, and it travels in
                // export archives — so it gets the same scrubbing explicitly.
                redact: (text) => String(redactPayload(text, handle.secrets)),
              },
            }),
          },
          ...(canResume ? { resume: task.sessionId! } : {}),
        },
      });
      handle.query = q;
      channel.push(userMessage(prompt));

      // Last non-empty main-thread prose (sticky — the content we'd surface as a report),
      // and the text of the most recent main-thread message in the CURRENT turn (which may
      // be empty, e.g. a turn that ended right after a tool call). The turn-scoped one is
      // what decides completion: sticky text can be many messages stale.
      let lastAssistantText = "";
      let turnText = "";
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
          turnText = text;
          if (text.trim()) lastAssistantText = text;
          if (DONE_AT_END.test(text)) {
            producedReport = true;
            // Mid-turn: this message's own `result` is still in flight. If the merge step
            // pushes a resolve turn, that stale result must be swallowed (see mergeOnDone).
            finalize(handle, "done", undefined, { resolve: "mid-turn" });
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
          const gate = lastAssistantText.match(GATE_AT_END);
          // Did this turn actually end on a result, or on the agent narrating its next
          // step? Classified from the turn's own last message, then reset for the next.
          const endText = turnText;
          const turnEnd = classifyTurnEnd(endText);
          turnText = "";
          // Captured here (not in the nudge branch) so the "paused" variant's `reason` is
          // available where the action-dispatch has widened `turnEnd` back to the union.
          const pauseReason = turnEnd.kind === "paused" ? turnEnd.reason : null;
          const action = resultAction({
            swallow: Boolean(handle.mergeResolveSwallowResult),
            isError: sub !== "success" || isErr,
            done: handle.done,
            pendingApproval: Boolean(handle.pendingApproval),
            hasGate: Boolean(gate),
            paused: turnEnd.kind === "paused",
            canNudge: autoContinues < MAX_AUTO_CONTINUE,
          });
          if (action === "swallow") {
            // This result belongs to the turn whose [[DONE]] already triggered the merge
            // step, which pushed the conflict-resolve turn — the agent hasn't seen that
            // prompt yet. Eaten *whatever its subtype*: even an error result here must not
            // seal the task, or the resolve turn is orphaned (usage above is already banked
            // — that must never be skipped). If the resolve turn can't run, the post-loop
            // finalize below is the backstop.
            handle.mergeResolveSwallowResult = false;
          } else if (action === "fail") {
            // error_during_execution / error_max_turns / error_max_budget_usd / …
            // (finalize no-ops if the task was already sealed.)
            const detail = (m as { result?: string }).result;
            finalize(
              handle,
              "failed",
              (isErr && detail) || `run ended: ${sub || "unknown error"}`,
            );
          } else if (action === "await") {
            // A tool-based gate is awaiting the user — keep the session alive.
          } else if (action === "gate") {
            // Prose-gate fallback: the agent signalled a gate via the marker
            // instead of the approval tool. Surface it so it stays actionable
            // (respond() pushes the decision back as a reply) rather than stuck.
            const kind = gate![1] === "PROPOSAL" ? "proposal" : "report";
            const summary = lastAssistantText
              .replace(/\[\[(DONE|GATE:[A-Z]+)\]\]/g, "")
              .trim();
            record(handle, "gate", { gate: kind, summary });
            setStatus(
              handle,
              kind === "proposal" ? "awaiting_proposal" : "awaiting_report",
            );
          } else if (action === "nudge") {
            // The agent ended the turn mid-workflow — it dispatched review subagents and
            // said it would resume, or it just announced its next step ("Let me read the
            // workflow rules:") and stopped. Either way it isn't done: nudge it to
            // continue rather than finalizing and passing its narration off as the report.
            autoContinues += 1;
            record(handle, "log", {
              message: `Agent paused mid-workflow (${pauseReason}); nudging it to finish (continue → report gate).`,
            });
            handle.pushInput(userMessage(nudgePrompt(pauseReason ?? "narration")));
          } else if (action === "pause-fail") {
            // Out of nudges and still stopping mid-work. Saying "done" here would be a
            // lie — and stapling [[DONE]] onto narration is exactly how a preamble ends
            // up rendered as the task's report. Fail honestly; Continue resumes it.
            const nudged = `nudged ${autoContinues} time${autoContinues === 1 ? "" : "s"}`;
            finalize(
              handle,
              "failed",
              producedReport
                ? `Agent stopped mid-workflow after its report (${nudged}), so the run may be incomplete. Use Continue to resume it.`
                : `Agent stopped mid-workflow without producing a final report (${nudged}). Use Continue to resume it.`,
            );
          } else if (action === "complete") {
            // Turn ended on a result-shaped message with nothing pending → the task is
            // complete. If the run produced no report (e.g. onboard, which prints a plain
            // summary with no [[DONE]] and no report gate), surface that summary as the
            // report so the user sees a result rather than an activity-only view. Only
            // this turn's own closing text qualifies — never stale prose from earlier.
            if (!producedReport && endText.trim()) {
              record(handle, "message", {
                type: "assistant",
                message: {
                  content: [{ type: "text", text: `${endText.trim()}\n\n[[DONE]]` }],
                },
              });
              producedReport = true;
            }
            // Turn boundary: the next `result` (if the merge step pushes a resolve turn)
            // belongs to the resolve turn itself and is handled normally.
            finalize(handle, "done", undefined, { resolve: "boundary" });
          }
          // action === "none": already finalized, nothing to do.
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

  // Serialize per project: at most one live job in the project's checkout. Two ways out of
  // the queue: the checkout is free, or this run is isolated in its own git worktree —
  // because it already ran in one (its work lives there / on its branch, so it must go
  // back), or because the user opted in ("run in parallel") and the project is busy right
  // now. A parallel-flagged task that finds the checkout free just runs there normally.
  // The decision itself is `launchMode` in ./worktree — pure, and tested there.
  const mode = launchMode({
    busy: projectBusy(project.id, taskId),
    parallel: task.parallel,
    workdir: task.workdir,
    isGit: project.isGit,
    isWorkspace: project.isWorkspace,
    feature: Boolean(task.featureId),
  });

  if (mode === "queue") {
    handle.start = launch;
    setStatus(handle, "queued");
    record(handle, "log", {
      message: "Queued — waiting for another job on this project to finish.",
    });
    return handle;
  }

  if (mode === "isolate") {
    try {
      // A feature-linked run's task branch is based on the feature branch, not on whatever
      // the checkout's HEAD happens to be — that's what gives every task of the feature (and
      // the later merge back into it) a common ancestor. First creates the feature branch
      // itself if this is the first feature-linked task to run (idempotent: a no-op once any
      // task of this feature has run before).
      let baseRef: string | undefined;
      if (task.featureId) {
        const feature = getFeature(task.featureId);
        if (feature) {
          ensureFeatureBranch(project.path, feature.branch, project.defaultBranch);
          baseRef = feature.branch;
        }
      }
      // Pass the branch stored on the row: after a cleanup, reattaching must go to the
      // branch the run actually ended on, not the derived task/<id> birth name. `baseRef`
      // only matters the very first time (reattaching an existing branch ignores it).
      const wtree = ensureTaskWorktree(project.path, taskId, {
        branch: task.branch,
        baseRef,
      });
      handle.worktree = { projectPath: project.path, dir: wtree.dir };
      // Persist where the run actually executes: the file/diff views resolve against
      // `workdir`, and `branch` is what survives cleanup (and names the chip on the page).
      if (task.workdir !== wtree.dir || task.branch !== wtree.branch) {
        db.update(tasks)
          .set({ workdir: wtree.dir, branch: wtree.branch })
          .where(eq(tasks.id, taskId))
          .run();
      }
      task.workdir = wtree.dir;
      task.branch = wtree.branch;
      record(handle, "log", {
        message: `🌿 Running in an isolated git worktree (branch ${wtree.branch}) — the project's main checkout stays free.`,
      });
    } catch (err) {
      finalize(
        handle,
        "failed",
        `Couldn't prepare the task's isolated worktree: ${(err as Error).message}`,
      );
      return handle;
    }
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
