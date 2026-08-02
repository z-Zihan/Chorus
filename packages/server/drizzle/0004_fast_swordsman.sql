ALTER TABLE `conversation_agents` ADD `position` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `conversation_agents`
SET `position` = (
	SELECT COUNT(*) - 1
	FROM `conversation_agents` AS `earlier`
	WHERE `earlier`.`conversation_id` = `conversation_agents`.`conversation_id`
		AND `earlier`.rowid <= `conversation_agents`.rowid
);
