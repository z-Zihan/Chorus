ALTER TABLE `conversation_agents` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `conversation_agents` ADD `agent_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `conversation_agents` ADD `owner_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `conversation_agents` ADD `hub_id_snapshot` text;--> statement-breakpoint
ALTER TABLE `conversation_agents` ADD `joined_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `relay_room_id` text;