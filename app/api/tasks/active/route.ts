import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, tasks, type TaskStatus } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownedBy } from "@/lib/task-access";
import { ACTIVE_STATUSES } from "@/lib/ui";
import {
  ACTIVE_LIST_LIMIT,
  activeTaskName,
  type ActiveTasksPayload,
} from "@/lib/active-tasks";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/active — the caller's in-flight runs, for the activity badge.
 *
 * Owner-scoped like every other task read (`ownedBy`), and **narrow on purpose**: this is
 * polled from every page every few seconds, and `GET /api/tasks` answers with every column of
 * every task you have ever run — 106 rows and ~150 KB on the machine this was written on,
 * growing for the life of the install, served by the same process that streams live
 * transcripts. Five short fields per active run is a payload the poll can afford.
 *
 * The status filter is the shared `ACTIVE_STATUSES`, so the badge counts exactly what the
 * dashboard's "In progress" stat and the update gate count.
 *
 * Not a static segment clash: `/api/tasks/[id]` sits beside this, and a static segment wins
 * over a dynamic one — but task ids are `task_<8 hex>`, so no real task is reachable at
 * `active` in the first place.
 */
export async function GET() {
  // Sign-in is optional; without one this is the local workspace, which owns its own tasks.
  const user = await getCurrentUser();

  const rows = db
    .select({
      id: tasks.id,
      title: tasks.title,
      requestText: tasks.requestText,
      status: tasks.status,
      createdAt: tasks.createdAt,
      // Joined rather than reading the whole projects table: active runs are few, and this
      // route answers far more often than any page does.
      project: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        ownedBy(user.id),
        // ACTIVE_STATUSES is a Set<string> because client components match raw status
        // strings against it; the column is typed to the union.
        inArray(tasks.status, [...ACTIVE_STATUSES] as TaskStatus[]),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .all();

  const payload: ActiveTasksPayload = {
    total: rows.length,
    tasks: rows.slice(0, ACTIVE_LIST_LIMIT).map((row) => ({
      id: row.id,
      name: activeTaskName(row),
      project: row.project,
      status: row.status,
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.getTime()
          : Number(row.createdAt),
    })),
  };

  return NextResponse.json(payload, {
    // Polled state: a cached answer is a stale badge.
    headers: { "cache-control": "no-store" },
  });
}
