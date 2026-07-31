/**
 * One-time backfill: give every untitled task a smart, human-readable name, the same
 * way the runner names new tasks at dispatch. Idempotent — only touches rows where
 * `title IS NULL`, so it's safe to re-run.
 *
 *   pnpm db:backfill-titles
 *
 * Run it where the agent SDK is authenticated (inside the container if you use Docker:
 *   docker compose -f infra/docker/docker-compose.yml exec platform pnpm db:backfill-titles
 * ). If a model call fails, that task falls back to a command-based default title.
 */
import { eq, isNull } from "drizzle-orm";
import { db } from "../lib/db";
import { projects, tasks } from "../lib/db/schema";
import { generateTitle } from "./model-router";
import { defaultTitle } from "./session-manager";
import { buildTaskEnv, type TaskEnv } from "./user-env";

async function main(): Promise<void> {
  const rows = db.select().from(tasks).where(isNull(tasks.title)).all();
  if (rows.length === 0) {
    console.log("No untitled tasks — nothing to backfill.");
    return;
  }
  console.log(`Backfilling ${rows.length} untitled task(s)…\n`);

  let i = 0;
  for (const t of rows) {
    i += 1;
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, t.projectId))
      .get();
    const projectName = project?.name ?? "the project";

    // Bill the task owner's token when they have one; this is an operator-run
    // script, so otherwise just use the operator's own environment as-is.
    let env: TaskEnv;
    try {
      env = buildTaskEnv(t.userId);
    } catch {
      env = { ...process.env };
    }

    let title: string | null = null;
    try {
      title = await generateTitle(t.command, t.requestText, env);
    } catch {
      /* fall back below */
    }
    const final = title ?? defaultTitle(t.command, projectName);

    db.update(tasks).set({ title: final }).where(eq(tasks.id, t.id)).run();
    console.log(`  [${i}/${rows.length}] /${t.command}  →  ${final}`);
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
