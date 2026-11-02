CREATE TABLE `api_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`encrypted_key` text,
	`iv` text,
	`model` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);
