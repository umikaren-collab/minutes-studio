CREATE TABLE `access_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`label` text NOT NULL,
	`daily_limit` integer NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_codes_code_hash_unique` ON `access_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `code_usage` (
	`code_id` text NOT NULL,
	`day` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`code_id`, `day`)
);
--> statement-breakpoint
ALTER TABLE `api_settings` ADD `daily_limit` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `upload_jobs` ADD `code_id` text;