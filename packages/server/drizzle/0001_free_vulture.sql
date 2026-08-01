CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `managed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `customized_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `catalog_entry_id` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `detection_fingerprint` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `disabled` integer DEFAULT false NOT NULL;