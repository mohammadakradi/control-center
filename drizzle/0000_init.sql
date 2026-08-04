CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`namespace` text NOT NULL,
	`version` text,
	`source_path` text NOT NULL,
	`plugin_id` text NOT NULL,
	`description` text,
	`commands` text DEFAULT '[]' NOT NULL,
	`scope` text,
	`discovered_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_agents` (
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_agent_unq` ON `project_agents` (`project_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`is_git` integer DEFAULT false NOT NULL,
	`default_branch` text,
	`onboarded` integer DEFAULT false NOT NULL,
	`is_workspace` integer DEFAULT false NOT NULL,
	`members` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_unique` ON `projects` (`path`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`ts` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`agent_id` text NOT NULL,
	`command` text NOT NULL,
	`agent_version` text,
	`request_text` text DEFAULT '' NOT NULL,
	`title` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`model` text DEFAULT 'auto' NOT NULL,
	`model_reason` text,
	`attachments` text DEFAULT '[]' NOT NULL,
	`session_id` text,
	`branch` text,
	`error` text,
	`usage_input_tokens` integer DEFAULT 0 NOT NULL,
	`usage_output_tokens` integer DEFAULT 0 NOT NULL,
	`usage_cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`usage_cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`usage_cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unq` ON `users` (`email`);