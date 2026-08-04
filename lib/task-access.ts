/**
 * Who can see and act on a task.
 *
 * Sign-in is optional, so there is no longer a middleware gate in front of the app — anyone who
 * opens it is *some* owner (a signed-in account, or the local workspace). That makes this the
 * only thing standing between two people sharing one install, so every task read goes through
 * here rather than filtering by hand at 13 call sites.
 *
 * Projects and agents are deliberately NOT scoped: a project is a folder on the device and an
 * agent is an installed plugin — both are properties of the machine, not of a person. Tasks and
 * their transcripts are the private part, along with each owner's Anthropic token.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { tasks, type Task } from "./db/schema";

/** Where-clause for "tasks belonging to this owner". Use in every task query. */
export function ownedBy(userId: string) {
  return eq(tasks.userId, userId);
}

/**
 * One task, but only if this owner has it. Returns null when the task doesn't exist *or* isn't
 * theirs — deliberately indistinguishable, so probing ids can't enumerate someone else's work.
 * Callers should 404 on null rather than 403.
 */
export function findOwnedTask(taskId: string, userId: string): Task | null {
  return (
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), ownedBy(userId)))
      .get() ?? null
  );
}
