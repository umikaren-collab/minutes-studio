CREATE TABLE `upload_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`state` text NOT NULL,
	`files_json` text NOT NULL,
	`model` text NOT NULL,
	`day` text NOT NULL,
	`expires_at` integer NOT NULL
);
