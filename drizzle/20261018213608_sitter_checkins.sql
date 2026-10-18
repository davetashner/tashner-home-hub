CREATE TABLE `sitter_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sitter_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sitter_checkins_session_idx` ON `sitter_checkins` (`session_id`,`at`);--> statement-breakpoint
ALTER TABLE `sitter_sessions` ADD `start_notified_at` integer;--> statement-breakpoint
ALTER TABLE `sitter_sessions` ADD `end_notified_at` integer;
--> statement-breakpoint
UPDATE `sitter_sessions` SET `start_notified_at` = `start_at`, `end_notified_at` = `end_at`;
