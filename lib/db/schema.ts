import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
// Type-only (erased at runtime): the backlog's assignee is the "which agent takes this" choice
// a pm spec expresses, plus pm itself — an item can be a problem waiting to be planned, not
// only a task waiting to be built. One union, defined next to the spec parser that shares it.
import type { BacklogAssignee } from "../pm-spec";

/** A registered account. */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("users_email_unq").on(t.email)],
);

/** A signed-in session, keyed by a hash of the opaque cookie token (never the raw token). */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // sha256 hex of the raw session token
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** A discovered Claude Code agent (a plugin). */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(), // plugin id, e.g. "swe@swe-agent-local"
  name: text("name").notNull(),
  namespace: text("namespace").notNull(), // slash-command namespace, e.g. "swe"
  version: text("version"), // plugin.json version, e.g. "0.4.0" (null if unset)
  sourcePath: text("source_path").notNull(), // local plugin dir
  pluginId: text("plugin_id").notNull(),
  description: text("description"),
  commands: text("commands", { mode: "json" })
    .notNull()
    .$type<AgentCommand[]>()
    .default(sql`'[]'`),
  scope: text("scope"), // user | project
  discoveredAt: integer("discovered_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type AgentCommand = {
  name: string; // e.g. "task"
  full: string; // e.g. "/swe:task"
  description?: string;
  argumentHint?: string;
};

/** A local project folder the agent can work in. */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  isGit: integer("is_git", { mode: "boolean" }).notNull().default(false),
  defaultBranch: text("default_branch"),
  onboarded: integer("onboarded", { mode: "boolean" }).notNull().default(false),
  isWorkspace: integer("is_workspace", { mode: "boolean" })
    .notNull()
    .default(false),
  members: text("members", { mode: "json" })
    .notNull()
    .$type<WorkspaceMember[]>()
    .default(sql`'[]'`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type WorkspaceMember = { path: string; role?: string };

/** Many-to-many link between projects and agents. */
export const projectAgents = sqliteTable(
  "project_agents",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("project_agent_unq").on(t.projectId, t.agentId)],
);

/** A file/photo the user attached to a task request. `path` is absolute (under data/uploads). */
export type Attachment = {
  name: string; // original filename
  path: string; // absolute path on disk
  type: string; // MIME type (best-effort)
  size: number; // bytes
};

/** Where a feature is in its life. Only `active` is ever written by the code that creates
 *  features — the other two are a human (or a later lifecycle step) closing one out. */
export type FeatureStatus = "active" | "done" | "cancelled";

/**
 * A feature: the unit work is actually organised around, spanning several tasks.
 *
 * Two things create one, mirroring how backlog items arrive. The pm agent plans a batch into
 * `.pm/tasks/<request>/`, and the backlog sync derives one feature per request folder — that
 * folder *is* the grouping, it was just buried inside `backlog_items.source_path` before. Or a
 * user creates one by hand and assigns items and tasks to it.
 *
 * Project-scoped and shared, exactly like the project and its backlog: a feature describes
 * planned work on a folder, not one person's view of it. The tasks it groups stay private to
 * whoever ran them (lib/task-access.ts).
 */
export const features = sqliteTable(
  "features",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The feature's git branch — `feature/<slug>`, reserved here and created for real by the
    // runner on the first feature-linked run. Immutable once assigned: renaming the feature
    // must not orphan a ref that may already exist in the repo (or be checked out).
    branch: text("branch").notNull(),
    status: text("status").notNull().$type<FeatureStatus>().default("active"),
    // The `.pm/tasks/<request>` folder this was derived from, project-relative. Unique per
    // project so the sync is idempotent; null for hand-made features (SQLite treats NULLs as
    // distinct in a unique index, so any number of them coexist — same trick as `source_path`).
    sourceDir: text("source_dir"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("features_source_dir_unq").on(t.projectId, t.sourceDir),
    // One branch per project: two features pointing at one ref would merge each other's work.
    uniqueIndex("features_branch_unq").on(t.projectId, t.branch),
  ],
);

/**
 * Where a feature-linked task's branch stands relative to its feature branch. Null means
 * "no feature" — there is nothing to merge. Set to "pending" at dispatch whenever `featureId`
 * is set, before the runner has decided how the task will even run; an isolated run that
 * reaches `done` updates it to "merged" (its branch merged cleanly into the feature branch)
 * or "conflict" (the merge was aborted — the task branch is left intact for manual
 * resolution). A non-isolated (checkout) feature run stays "pending" forever: the platform
 * never system-merges it, so "pending" there is the honest answer, not a stuck state.
 */
export type TaskMergeState = "pending" | "merged" | "conflict";

export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_proposal"
  | "building"
  | "awaiting_report"
  | "committing"
  | "done"
  | "failed"
  | "cancelled";

/** Statuses a task never leaves. Anything else means a session is (or should be) alive. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  "done",
  "failed",
  "cancelled",
];

/** A dispatched task / agent run. */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Who dispatched the task. Scopes billing/attribution (the owner's Anthropic token
  // runs the session), not visibility — projects/agents stay shared. Nullable: tasks
  // predating auth are unowned, and tasks outlive a deleted user for team history.
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  // Which feature this run belongs to, if any. `set null` so closing out a feature never
  // deletes the history of the work done under it. Set at dispatch (from the backlog item, or
  // passed in for a manual run) and freely reassignable afterwards — unlike a synced backlog
  // item's grouping, nothing on disk re-derives a task's.
  featureId: text("feature_id").references(() => features.id, { onDelete: "set null" }),
  // See `TaskMergeState`. Independent of `status`: a task can be `done` and `mergeState`
  // `conflict` at once — the agent's work finished, the system merge of it didn't.
  mergeState: text("merge_state").$type<TaskMergeState>(),
  command: text("command").notNull(), // onboard | task | fix | review | ship | workspace
  // The agent's plugin version at the time this task ran (snapshot — the agent may be
  // upgraded later, so history records which version actually did the work). Null for
  // tasks created before versions were tracked.
  agentVersion: text("agent_version"),
  requestText: text("request_text").notNull().default(""),
  // Smart, human-readable name (e.g. "Add invoice approval flow"), generated from
  // the request at dispatch so history is scannable by intent, not by command.
  // Null until generated; the UI falls back to the request text, then the command.
  title: text("title"),
  status: text("status").notNull().$type<TaskStatus>().default("queued"),
  // Model routing: the user's choice ("auto" or a concrete label like "fable-5"),
  // overwritten by the runner with the resolved label once selected.
  model: text("model").notNull().default("auto"),
  modelReason: text("model_reason"),
  // Files/photos the user attached to the request (stored under data/uploads/<taskId>/).
  attachments: text("attachments", { mode: "json" })
    .notNull()
    .$type<Attachment[]>()
    .default(sql`'[]'`),
  sessionId: text("session_id"), // SDK session_id, for resume fallback
  // The task's git branch. Written when the run is isolated in a worktree (the branch the
  // worktree was created on — it survives cleanup, so commits stay reachable and a continue
  // can rebuild the tree from it).
  branch: text("branch"),
  // Opt-in from dispatch: if the project is busy when this task launches, run it in an
  // isolated git worktree instead of queueing. Meaningless for non-git/workspace projects
  // (dispatch refuses the flag there).
  parallel: integer("parallel", { mode: "boolean" }).notNull().default(false),
  // Where the run actually executed when it was isolated: an absolute path under
  // data/worktrees/. Null = the project checkout. Task-scoped reads (file/diff views)
  // resolve against this, not the project path. The dir may be cleaned up after a clean
  // `done` — the branch column is what stays authoritative for committed content.
  workdir: text("workdir"),
  error: text("error"),
  // What this task cost to run, accumulated over every SDK turn it took — including
  // continues/resumes, which each spawn a fresh subprocess whose own counters restart
  // (see runner/usage.ts for how the deltas are derived). Totals cover every model the
  // run touched: the main agent, its subagents, and the router/title calls.
  usageInputTokens: integer("usage_input_tokens").notNull().default(0),
  usageOutputTokens: integer("usage_output_tokens").notNull().default(0),
  usageCacheReadTokens: integer("usage_cache_read_tokens").notNull().default(0),
  usageCacheCreationTokens: integer("usage_cache_creation_tokens").notNull().default(0),
  usageCostUsd: real("usage_cost_usd").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  endedAt: integer("ended_at", { mode: "timestamp" }),
});

export type BacklogStatus = "todo" | "in_progress" | "done" | "cancelled";

/** How an item got here. `pm-sync` items mirror a file on disk; the other two are typed in. */
export type BacklogSource = "pm-sync" | "agent" | "manual";

/**
 * A planned piece of work on a project — the durable queue the pm agent's `.pm/tasks/` specs
 * land in, plus anything a user or an agent adds by hand.
 *
 * Project-scoped and shared, like the project itself: a backlog describes a folder on the
 * device, not one person's view of it. The *task* an item dispatches is still private to
 * whoever ran it (see lib/task-access.ts).
 */
export const backlogItems = sqliteTable(
  "backlog_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // The body handed to the agent when the item is run. For a synced spec that's the
    // markdown file verbatim, so a run doesn't depend on the file still being readable.
    description: text("description").notNull().default(""),
    assignee: text("assignee").$type<BacklogAssignee>(), // null → derived at dispatch
    status: text("status").notNull().$type<BacklogStatus>().default("todo"),
    priority: text("priority"), // free-form, as the spec frontmatter writes it (e.g. "P1")
    // Project-relative path of the `.pm/tasks/` spec this mirrors. Unique per project so sync
    // is idempotent; null for hand-added items (SQLite treats NULLs as distinct in a unique
    // index, so any number of them coexist).
    sourcePath: text("source_path"),
    // Which feature this item belongs to. For a synced spec the sync owns it — it is derived
    // from the item's `.pm/tasks/<request>/` folder and re-derived on every load, so the API
    // refuses to edit it, the same as the other fields the file owns. Hand-added items are
    // assigned freely. `set null` so closing out a feature doesn't take the work with it.
    featureId: text("feature_id").references(() => features.id, { onDelete: "set null" }),
    source: text("source").notNull().$type<BacklogSource>().default("manual"),
    // The task most recently dispatched from this item. `set null` so deleting a task's
    // history doesn't take the backlog item with it.
    linkedTaskId: text("linked_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    // Set once a human has chosen this status explicitly. Sync and the linked-task
    // reflection both refuse to move an item after that — a manual call always wins.
    statusOverride: integer("status_override", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("backlog_source_path_unq").on(t.projectId, t.sourcePath)],
);

export type TaskEventType =
  | "message"
  | "partial"
  | "gate"
  | "tool"
  | "result"
  | "status"
  | "log";

/** Append-only log of everything that happened during a task (powers live stream + replay). */
export const taskEvents = sqliteTable("task_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  ts: integer("ts", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  type: text("type").notNull().$type<TaskEventType>(),
  payload: text("payload", { mode: "json" }).notNull().$type<unknown>(),
});

export type Agent = typeof agents.$inferSelect;
export type BacklogItem = typeof backlogItems.$inferSelect;
export type Feature = typeof features.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
