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
  type Project,
  type Task,
} from "./db/schema";
import { daemonStartTask } from "./daemon-client";
import { findFeature } from "./features";
import { canRunTasks, secretsConfigured } from "./secrets";
import { newId } from "./util";
import { modelAllowed } from "./agent-policy";
import { normalizeEffortChoice, normalizeModelChoice } from "./models";

/** Anything unrecognised falls back to routing, rather than being handed to the SDK.
 *  Legacy labels ("sonnet"/"opus"/"sonnet-4.6") still resolve so a historical task can be
 *  continued on what it started with — see `lib/models.ts`. */
export function resolveModel(requested: string | undefined | null): string {
  return normalizeModelChoice(requested);
}

/** Same, for reasoning effort: an unknown level routes rather than guessing. */
export function resolveEffortChoice(requested: string | undefined | null): string {
  return normalizeEffortChoice(requested);
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

/**
 * Should a dispatch UI offer "Run isolated (parallel)" for this project?
 *
 * One definition, shared by every page that dispatches — the composer, the backlog and a
 * task's file modal — and it lives beside `createAndStartTask` on purpose: **the offer and the
 * refusal must not drift.** Offering the flag where the dispatch answers 400 turns a click into
 * an error. `lib/dispatch.test.ts` pins the two together.
 *
 * This is exactly "where the dispatch accepts the flag" — a plain git repo that isn't a
 * workspace — with **no busyness clause**, and the checkbox defaults to *checked* in every
 * host (2026-08-22, at the user's request: isolation is the default, queueing is the manual
 * choice). It used to also require the checkout to be busy at render time, which made the
 * offer a page-load snapshot: the first dispatch against a free checkout never saw it, a
 * batch needed a reload between runs, and — the part that actually hurt — a feature-linked
 * task dispatched without the flag ran *in the checkout*, checked the feature branch out
 * there, and blocked every isolated sibling's merge-back. The flag is harmless when the
 * checkout is free (the runner re-decides at launch: free + no feature simply runs in the
 * checkout), so gating the offer on busyness bought nothing except those misses.
 */
export function parallelOffer(
  project: Pick<Project, "id" | "isGit" | "isWorkspace">,
): boolean {
  // The two refusals in `createAndStartTask` — nothing else.
  return project.isGit && !project.isWorkspace;
}

export type DispatchInput = {
  projectId: string;
  agentId: string;
  command: string;
  /** Owner of the run: their Anthropic token executes it, and only they see the transcript. */
  userId: string;
  requestText?: string;
  model?: string | null;
  /** Reasoning effort: "auto" or a level. Lower means fewer tool calls and a shorter run. */
  effort?: string | null;
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
  /**
   * Which feature this run belongs to — from the backlog item being run, or chosen for a
   * manual dispatch. Refused up front unless it names a feature of `projectId`: a feature
   * groups work on one project, so a forged id would link this run into another project's
   * grouping (and, once the runner merges onto feature branches, into another repo's branch).
   */
  featureId?: string | null;
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

  // Same stance as `parallel`: refuse before the row exists rather than dropping the link.
  // A task silently landing in no feature would be invisible in every grouped view, and once
  // the runner merges a feature's work this is what decides which branch the run targets.
  if (input.featureId && !findFeature(input.projectId, input.featureId)) {
    return {
      ok: false,
      status: 400,
      error: "featureId does not name a feature of this project",
    };
  }

  const id = input.taskId ?? newId("task");

  // Snapshot the agent's current version so history records which version ran this task.
  const agent = db
    .select({ version: agents.version, namespace: agents.namespace })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .get();

  // Enforce the per-agent model policy on an *explicit* pick, before the row exists.
  // "Not allowed" has to mean refused, not merely absent from the dropdown — otherwise the
  // setting is decoration that any API caller can step around. "auto" is not checked here:
  // the router clamps its own choice to the policy, so it can never select a denied model.
  const wantedModel = resolveModel(input.model);
  if (wantedModel !== "auto" && agent && !modelAllowed(agent.namespace, wantedModel)) {
    return {
      ok: false,
      status: 400,
      error:
        `${wantedModel} is not allowed for the ${agent.namespace} agent. ` +
        `Change it in Settings → Agent models, or pick another model.`,
    };
  }

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
      effort: resolveEffortChoice(input.effort),
      attachments: input.attachments ?? [],
      parallel: input.parallel ?? false,
      featureId: input.featureId ?? null,
      // "pending" the moment a feature is linked — before the runner has even decided how
      // this task will run — so a queued or checkout-bound feature task shows a state rather
      // than reading identically to one with no feature at all.
      mergeState: input.featureId ? "pending" : null,
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
