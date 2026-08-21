CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`branch` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_dir` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `features_source_dir_unq` ON `features` (`project_id`,`source_dir`);--> statement-breakpoint
CREATE UNIQUE INDEX `features_branch_unq` ON `features` (`project_id`,`branch`);--> statement-breakpoint
ALTER TABLE `backlog_items` ADD `feature_id` text REFERENCES features(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `tasks` ADD `feature_id` text REFERENCES features(id) ON DELETE set null;