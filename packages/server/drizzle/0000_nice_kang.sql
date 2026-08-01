CREATE TABLE IF NOT EXISTS `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`avatar` text,
	`type` text NOT NULL,
	`config` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_agents` (
	`conversation_id` text NOT NULL,
	`agent_id` text NOT NULL,
	PRIMARY KEY(`conversation_id`, `agent_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`type` text DEFAULT 'dm' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text,
	`to_id` text,
	`content` text NOT NULL,
	`thread_id` text,
	`parent_id` text,
	`status` text DEFAULT 'done' NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_conversation` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_thread` ON `messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_parent` ON `messages` (`parent_id`);
