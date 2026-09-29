CREATE TABLE `test_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`source_path` text NOT NULL,
	`origin` text NOT NULL,
	`feature_id` text,
	`feature_hint` text,
	`status` text DEFAULT 'open' NOT NULL,
	`status_override` integer DEFAULT false NOT NULL,
	`archived_path` text,
	`last_task_id` text,
	`last_run_at` integer,
	`last_passed` integer DEFAULT 0 NOT NULL,
	`last_failed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_scenario_source_path_unq` ON `test_scenarios` (`project_id`,`source_path`);