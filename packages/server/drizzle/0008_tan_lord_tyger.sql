CREATE TABLE `user_hubs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hub_id` text NOT NULL,
	`hub_display_name` text,
	`bound` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
