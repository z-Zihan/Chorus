ALTER TABLE `conversations` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `archived` integer DEFAULT false NOT NULL;