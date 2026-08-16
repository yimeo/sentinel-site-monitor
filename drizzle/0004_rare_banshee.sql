ALTER TABLE `monitor_tasks` ADD `forbiddenContent` text;--> statement-breakpoint
ALTER TABLE `monitor_tasks` ADD `alertMode` enum('once','repeat') DEFAULT 'once' NOT NULL;--> statement-breakpoint
ALTER TABLE `monitor_tasks` ADD `repeatAlertMinutes` int DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `monitor_tasks` ADD `lastAlertAt` timestamp;