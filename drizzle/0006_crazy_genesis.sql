DROP INDEX `monitor_tasks_due_idx` ON `monitor_tasks`;--> statement-breakpoint
ALTER TABLE `monitor_tasks` ADD `nextCheckAt` timestamp;--> statement-breakpoint
CREATE INDEX `monitor_tasks_due_idx` ON `monitor_tasks` (`enabled`,`nextCheckAt`);