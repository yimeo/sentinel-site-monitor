ALTER TABLE `site_settings` ADD `repeatAlertSubject` text DEFAULT '[Sentinel] 故障告警{{alertCount}}（N）：{{taskName}} 故障持续时长：{{outageDuration}}' NOT NULL;
