CREATE TABLE `backlog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`assignee` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text,
	`source_path` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`linked_task_id` text,
	`status_override` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backlog_source_path_unq` ON `backlog_items` (`project_id`,`source_path`);