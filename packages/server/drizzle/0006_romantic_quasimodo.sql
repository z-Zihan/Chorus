CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar` text,
	`hub_id` text,
	`public_key` text,
	`kind` text DEFAULT 'local' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `owner_id` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `agents` ADD `owner_type` text DEFAULT 'system' NOT NULL;