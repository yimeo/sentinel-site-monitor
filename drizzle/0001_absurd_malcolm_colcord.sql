CREATE TABLE `monitor_checks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskId` int NOT NULL,
	`status` enum('success','http_error','content_mismatch','network_error','timeout') NOT NULL,
	`checkedAt` timestamp NOT NULL DEFAULT (now()),
	`responseTimeMs` int,
	`httpStatus` int,
	`errorMessage` text,
	`expectedContentMatched` boolean,
	CONSTRAINT `monitor_checks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitor_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`url` varchar(2048) NOT NULL,
	`expectedContent` text,
	`intervalMinutes` int NOT NULL DEFAULT 5,
	`enabled` boolean NOT NULL DEFAULT true,
	`status` enum('unknown','up','down','content_mismatch') NOT NULL DEFAULT 'unknown',
	`lastCheckedAt` timestamp,
	`lastResponseTimeMs` int,
	`lastHttpStatus` int,
	`lastError` text,
	`alertOpen` boolean NOT NULL DEFAULT false,
	`lastFailureAt` timestamp,
	`lastRecoveredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `smtp_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`host` varchar(320) NOT NULL,
	`port` int NOT NULL,
	`secure` boolean NOT NULL DEFAULT false,
	`username` varchar(320),
	`passwordEncrypted` text,
	`fromEmail` varchar(320) NOT NULL,
	`recipients` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `smtp_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `smtp_settings_owner_unique` UNIQUE(`ownerId`)
);
--> statement-breakpoint
CREATE INDEX `monitor_checks_task_checked_idx` ON `monitor_checks` (`taskId`,`checkedAt`);--> statement-breakpoint
CREATE INDEX `monitor_tasks_owner_idx` ON `monitor_tasks` (`ownerId`);--> statement-breakpoint
CREATE INDEX `monitor_tasks_due_idx` ON `monitor_tasks` (`enabled`,`lastCheckedAt`);