ALTER TABLE `conversation_agents` ADD `owner_proof` text;--> statement-breakpoint
CREATE TABLE `room_state_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`revision` integer NOT NULL,
	`key_epoch` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_signature` text NOT NULL,
	`timestamp` integer NOT NULL,
	`data` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_room_state_events_room_revision` ON `room_state_events` (`room_id`,`revision`);
