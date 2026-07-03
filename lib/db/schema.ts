import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

/** A dispatched task / agent run. */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
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
  // Model routing: the user's choice ("auto" | "sonnet" | "opus"), overwritten by the
  // runner with the resolved label once selected.
  model: text("model").notNull().default("auto"),
  modelReason: text("model_reason"),
  // Files/photos the user attached to the request (stored under data/uploads/<taskId>/).
  attachments: text("attachments", { mode: "json" })
    .notNull()
    .$type<Attachment[]>()
    .default(sql`'[]'`),
  sessionId: text("session_id"), // SDK session_id, for resume fallback
  branch: text("branch"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  endedAt: integer("ended_at", { mode: "timestamp" }),
});

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
export type Project = typeof projects.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
