/**
 * Creating and starting a task — the one path a run is born on.
 *
 * Extracted from `POST /api/tasks` so a second caller (running a backlog item) reuses the
 * whole sequence rather than reimplementing it: the token gate, the model allowlist, the
 * agent-version snapshot, the project↔agent link, and marking the row failed if the runner
 * won't take it. Anything that dispatches must go through here, or it will drift from the
 * guarantees the API route already makes.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  agents,
  projectAgents,
  projects,
  tasks,
  type Attachment,
  type Task,
} from "./db/schema";
import { daemonStartTask } from "./daemon-client";
import { canRunTasks, secretsConfigured } from "./secrets";
import { newId } from "./util";

/** "sonnet"/"opus"/"sonnet-4.6" are legacy aliases — the router maps them to the current
 *  equivalents (Sonnet 4.6 is retired → Sonnet 5). */
const ALLOWED_MODELS = new Set([
  "auto",
  "fable-5",
  "opus-5",
  "sonnet-5",
  "opus-4.8",
  "sonnet",
  "opus",
  "sonnet-4.6",
]);

/** Anything unrecognised falls back to routing, rather than being handed to the SDK. */
export function resolveModel(requested: string | undefined | null): string {
  return ALLOWED_MODELS.has(requested ?? "") ? (requested as string) : "auto";
}

export type DispatchRefusal = {
  status: number;
  error: string;
  /** Set when the reason is a missing Anthropic token, which the UI prompts for. */
  needsToken?: boolean;
  /** Set when a task row exists but couldn't be started — the UI links to it. */
  taskId?: string;
};

export type DispatchOutcome = { ok: true; task: Task } | ({ ok: false } & DispatchRefusal);

/**
 * Why this user can't dispatch, or null if they can. Callers that do expensive work first
 * (saving uploads) should check this before that work, so a refusal doesn't leave debris; it
 * is checked again inside `createAndStartTask`, which is the authoritative gate on this side.
 * The runner checks independently and has the last word.
 */
export function dispatchRefusal(userId: string): DispatchRefusal | null {
  if (canRunTasks(userId)) return null;
  // Distinguish "this user hasn't added a token" from "the server can't read any token" —
  // same refusal, but only one of them is the user's to fix.
  return {
    status: 412,
    needsToken: true,
    error: secretsConfigured()
      ? "Add your Anthropic token under Settings before dispatching tasks — each user runs on their own credential."
      : "The server is missing SECRETS_MASTER_KEY, so stored tokens can't be read. Ask whoever runs this instance to set it (see .env.example).",
  };
}

export type DispatchInput = {
  projectId: string;
  agentId: string;
  command: string;
  /** Owner of the run: their Anthropic token executes it, and only they see the transcript. */
  userId: string;
  requestText?: string;
  model?: string | null;
  attachments?: Attachment[];
  /** Pre-allocated id, for callers that had to name the task before the row existed
   *  (uploads land in `data/uploads/<taskId>/`). */
  taskId?: string;
  /**
   * A title the caller already knows, which suppresses the runner's naming call.
   *
   * The runner only names a task when the row has no title (`nameTask` in
   * `runner/session-manager.ts`), and naming costs a real Haiku round-trip on the owner's
   * token. A backlog item was titled by whoever planned or filed it, so summarising its own
   * request text back into a worse title is a call nobody needs to pay for.
   */
  title?: string | null;
  /**
   * Opt in to running concurrently if the project is busy at launch: the runner then puts
   * this task in its own git worktree (own working tree + branch) instead of queueing it.
   * Only meaningful for a plain git project — refused up front for non-git projects (no
   * worktrees to make) and workspaces (several member repos make "the" worktree ambiguous).
   */
  parallel?: boolean;
};

/** Titles are shown in lists and are not free-form input — cap them like the generated ones
 *  (`generateTitle` caps at 80) and drop anything that would render as a blank row. Cut by
 *  code point, not by `slice`: a title ending in an emoji would otherwise be truncated
 *  mid-surrogate-pair and render as a replacement character. */
function cleanTitle(title: string | null | undefined): string | null {
  const collapsed = (title ?? "").replace(/\s+/g, " ").trim();
  const t = [...collapsed].slice(0, 80).join("");
  return t || null;
}

/** The installed agent for a namespace (`swe`, `fe`), or null if none is installed.
 *  Prefers a CLI-registered plugin over the copy bundled with the app, matching
 *  `lib/discovery/agents.ts`'s own precedence. */
export function agentForNamespace(namespace: string): { id: string } | null {
  const rows = db
    .select({ id: agents.id, scope: agents.scope })
    .from(agents)
    .where(eq(agents.namespace, namespace))
    .all();
  const chosen = rows.find((r) => r.scope !== "bundled") ?? rows[0];
  return chosen ? { id: chosen.id } : null;
}

/** Create the task row and hand it to the runner. Never throws: a runner that won't take the
 *  task leaves a `failed` row the user can see, and the reason comes back as a refusal. */
export async function createAndStartTask(input: DispatchInput): Promise<DispatchOutcome> {
  const refused = dispatchRefusal(input.userId);
  if (refused) return { ok: false, ...refused };

  // Parallel isolation needs a repo to make a worktree of. Refuse before creating the row:
  // silently downgrading the flag would run two sessions in one checkout the moment the
  // caller's "is it busy?" information was stale in the wrong direction.
  if (input.parallel) {
    const project = db
      .select({ isGit: projects.isGit, isWorkspace: projects.isWorkspace })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .get();
    if (!project) return { ok: false, status: 404, error: "project not found" };
    if (!project.isGit || project.isWorkspace) {
      return {
        ok: false,
        status: 400,
        error: project.isWorkspace
          ? "Parallel runs aren't available on a workspace — its member repos make the isolated worktree ambiguous. Dispatch normally to queue."
          : "Parallel runs need a git repository — this project isn't one. Dispatch normally to queue.",
      };
    }
  }

  const id = input.taskId ?? newId("task");

  // Snapshot the agent's current version so history records which version ran this task.
  const agent = db
    .select({ version: agents.version })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .get();

  db.insert(tasks)
    .values({
      id,
      projectId: input.projectId,
      agentId: input.agentId,
      userId: input.userId,
      command: input.command,
      agentVersion: agent?.version ?? null,
      requestText: input.requestText ?? "",
      title: cleanTitle(input.title),
      status: "queued",
      model: resolveModel(input.model),
      attachments: input.attachments ?? [],
      parallel: input.parallel ?? false,
    })
    .run();

  // Ensure the agent is linked to the project.
  db.insert(projectAgents)
    .values({ projectId: input.projectId, agentId: input.agentId })
    .onConflictDoNothing()
    .run();

  try {
    await daemonStartTask(id);
  } catch (err) {
    const error = (err as Error).message;
    db.update(tasks).set({ status: "failed", error }).where(eq(tasks.id, id)).run();
    return { ok: false, status: 502, error, taskId: id };
  }

  return { ok: true, task: db.select().from(tasks).where(eq(tasks.id, id)).get()! };
}
