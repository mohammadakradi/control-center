/**
 * `add_backlog_item` — how a running agent files work it noticed but shouldn't do now.
 *
 * Agents surface follow-ups mid-task ("this route has no CSRF check", "these two components
 * should share a base") that don't belong in the task they're on. Without somewhere to put
 * them they end up in a report nobody re-reads. This writes them into the project's backlog
 * (`lib/backlog.ts`) with `source: "agent"`, so the provenance is visible to whoever later
 * decides to run one.
 *
 * Two things about this tool are load-bearing:
 *
 * **The project is not an argument.** It comes from the session's own handle, so an agent
 * working in one project cannot file work into another project's backlog — backlogs are shared
 * install-wide (see lib/task-access.ts), and a project id is guessable.
 *
 * **The handler never throws.** A rejected promise from an MCP tool handler surfaces as a
 * session-level error, which would turn "the backlog is full" into a dead task. Every refusal
 * comes back as an ordinary tool result with `isError: true`, which is what tells the model to
 * adjust rather than retry blindly.
 */
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  backlogItemCount,
  createBacklogItem,
  MAX_ITEMS_PER_PROJECT,
  parseNewBacklogItem,
} from "../lib/backlog";
import { db } from "../lib/db";
import { backlogItems, projects, type BacklogStatus } from "../lib/db/schema";

/**
 * How many items one task may add. The per-project cap alone isn't enough: an agent in a loop
 * would spend the whole project's quota and lock the *user* out of adding anything, and a run
 * that wants twenty pieces of follow-up work has misunderstood the tool.
 */
export const MAX_AGENT_ITEMS_PER_TASK = 20;

/**
 * Tighter than the 20 000 characters a person may type, because the two aren't the same act: an
 * agent-filed item is a follow-up note, and a model can max out the field on every call where a
 * human can't. It bounds the worst case a compromised agent can drive — the whole backlog is
 * returned on every (unauthenticated) load, and the per-launch allowance resets on resume, so
 * the product of the two caps is the number that matters.
 */
export const MAX_AGENT_DESCRIPTION_LENGTH = 4_000;

/** Statuses that mean the work is still outstanding — the window the dedupe looks at. */
const OPEN_STATUSES: readonly BacklogStatus[] = ["todo", "in_progress"];

export type BacklogToolContext = {
  /** The project this session runs against. Deliberately not a tool argument. */
  projectId: string;
  /** Writes a line into the task transcript, so an add (or a refusal) is never silent. */
  onLog?: (message: string) => void;
  /**
   * Strips the task's injected credentials out of text before it is stored.
   *
   * `record()` already does this for everything reaching `task_events`, but a backlog row goes
   * somewhere *wider* than a transcript: it is readable by every workspace on the install and
   * it travels in export archives. An agent talked into pasting the owner's token into a
   * description would otherwise park that credential where the transcript redaction was
   * specifically written to stop it going.
   */
  redact?: (text: string) => string;
};

const DESCRIPTION =
  "Record a piece of follow-up work in this project's backlog for someone to pick up later. " +
  "Call this when the user asks you to add something to the backlog, or when you find work " +
  "that is genuinely out of scope for the task you are on and would otherwise be forgotten. " +
  "It does not pause your turn and does not start the work: the item is queued as 'todo' for " +
  "a human to dispatch. Do not use it as a to-do list for the task you are currently doing.";

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Redact, and for a title also flatten it to one line.
 *
 * Titles head a list row and, for a hand-added item, the first line of the prompt a dispatched
 * run is given (`backlogRequestText`) — so a newline or control character in one is never
 * meaningful and would let a run's preamble be forged. Collapsing beats refusing: an agent
 * shouldn't have to retry over whitespace. Descriptions keep their newlines; they're a body.
 *
 * Both run before validation, so the caps apply to what actually gets stored (redacting can
 * lengthen text). Non-strings pass through untouched for the validator to name, rather than
 * throwing `value.replace is not a function` at a caller who would only see a dead session.
 */
function cleanText(
  value: unknown,
  scrub: (text: string) => string,
  collapse = false,
): unknown {
  if (typeof value !== "string") return value;
  const scrubbed = scrub(value);
  return collapse ? scrubbed.replace(/[\x00-\x1f\x7f]+/g, " ") : scrubbed;
}

/** An outstanding item with this exact title, if one is already recorded. */
function openItemWithTitle(projectId: string, title: string) {
  return (
    db
      .select()
      .from(backlogItems)
      .where(
        and(
          eq(backlogItems.projectId, projectId),
          eq(backlogItems.title, title),
          inArray(backlogItems.status, [...OPEN_STATUSES]),
        ),
      )
      .get() ?? null
  );
}

/**
 * Build the tool for one session. The per-task counter lives in this closure, so it resets
 * when a task is continued or resumed — each launch gets its own allowance.
 */
export function makeBacklogTool(ctx: BacklogToolContext) {
  let added = 0;

  return tool(
    "add_backlog_item",
    DESCRIPTION,
    {
      title: z
        .string()
        .describe("Short summary of the work, as it should read in a backlog list."),
      description: z
        .string()
        .optional()
        .describe(
          "What the work is and why it matters — this is what a future agent is handed when " +
            "the item is run, so include the context they won't have.",
        ),
      assignee: z
        .enum(["fe", "swe"])
        .optional()
        .describe(
          "Which agent should take it: 'fe' for frontend/UI work, 'swe' for everything else. " +
            "Omit if it isn't clearly one or the other.",
        ),
    },
    async (args) => {
      try {
        // Fields are listed explicitly rather than spread: the validator also understands
        // `status`, which is a human's call to make, not an agent's.
        const scrub = ctx.redact ?? ((text: string) => text);
        const parsed = parseNewBacklogItem({
          title: cleanText(args.title, scrub, true),
          description: cleanText(args.description, scrub),
          // Not cleaned, deliberately: zod has already narrowed it to one of two literals, so
          // there is no free text here to scrub. A future free-text field would need cleaning.
          assignee: args.assignee,
        });
        if (!parsed.ok) return textResult(refuse(ctx, parsed.error), true);

        if ((parsed.value.description ?? "").length > MAX_AGENT_DESCRIPTION_LENGTH) {
          return textResult(
            refuse(
              ctx,
              `a backlog item you file may hold ${MAX_AGENT_DESCRIPTION_LENGTH} characters of description. Summarise the work rather than pasting it.`,
            ),
            true,
          );
        }

        // The FK would catch this, but foreign keys aren't reliably enforced on this database
        // (see .swe/notes.md), and an orphaned row appears in no project's backlog at all.
        const project = db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, ctx.projectId))
          .get();
        if (!project) {
          return textResult(
            refuse(ctx, "this task's project is no longer registered, so it has no backlog."),
            true,
          );
        }

        // Agents retry tool calls, and a retried add is the same piece of work twice. Answering
        // with the existing item makes the call idempotent instead of merely erroring.
        //
        // Checked ahead of both caps on purpose: this branch writes nothing, so "it's already on
        // the list" stays true and stays useful even for a session that has spent its allowance.
        // Refusing a retry with "you've added too many" would be a worse answer to a call that
        // was asking for something already done.
        const existing = openItemWithTitle(ctx.projectId, parsed.value.title);
        if (existing) {
          return textResult(
            `Already in this project's backlog: "${existing.title}" (id ${existing.id}, status ${existing.status}). Nothing was added.`,
          );
        }

        if (added >= MAX_AGENT_ITEMS_PER_TASK) {
          return textResult(
            refuse(
              ctx,
              `this task has already added ${MAX_AGENT_ITEMS_PER_TASK} backlog items, which is the limit for one run. Put anything further in your report instead.`,
            ),
            true,
          );
        }

        if (backlogItemCount(ctx.projectId) >= MAX_ITEMS_PER_PROJECT) {
          return textResult(
            refuse(
              ctx,
              `this project's backlog is full (${MAX_ITEMS_PER_PROJECT} items). Report the work instead.`,
            ),
            true,
          );
        }

        const item = createBacklogItem(ctx.projectId, {
          title: parsed.value.title,
          description: parsed.value.description,
          assignee: parsed.value.assignee,
          source: "agent",
        });
        added += 1;
        note(ctx, `📋 Added to the backlog: "${item.title}"`);
        return textResult(
          `Added to this project's backlog: "${item.title}" (id ${item.id}, assignee ${item.assignee ?? "unset"}). ` +
            "It is recorded as 'todo' for a human to pick up — there is nothing further for you to do about it.",
        );
      } catch (err) {
        return textResult(refuse(ctx, `it could not be saved (${(err as Error).message}).`), true);
      }
    },
  );
}

/**
 * A transcript line is best-effort and must never decide the call's outcome. `onLog` writes to
 * the database (`record`), so it can fail on its own — and an item that was added and then
 * failed to log is still added. Unguarded it would be worse than a wrong message: the handler's
 * own `catch` calls `refuse`, which logs, so a throw from here would escape the handler
 * entirely, and a rejected MCP handler takes the whole task down rather than the tool call.
 */
function note(ctx: BacklogToolContext, message: string): void {
  try {
    ctx.onLog?.(message);
  } catch {
    /* the transcript is not worth failing, or losing, an add over */
  }
}

/** Refusals are logged as well as returned: "the agent said it filed it" must not be silent. */
function refuse(ctx: BacklogToolContext, reason: string): string {
  note(ctx, `📋 Backlog item not added — ${reason}`);
  return `Could not add the backlog item: ${reason}`;
}
