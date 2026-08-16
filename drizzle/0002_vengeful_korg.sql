CREATE TABLE `scheduler_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`cronTokenHash` varchar(128) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduler_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduler_settings_owner_unique` UNIQUE(`ownerId`)
);
