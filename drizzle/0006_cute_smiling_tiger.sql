CREATE TABLE `agent_model_policies` (
	`namespace` text PRIMARY KEY NOT NULL,
	`allowed_models` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `effort` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `effort_reason` text;