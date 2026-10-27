CREATE TABLE `practice_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`minutes` integer NOT NULL,
	`date` text NOT NULL,
	`stars` integer DEFAULT 0 NOT NULL,
	`star_tx_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`activity_id`) REFERENCES `practice_activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `practice_logs_member_date_idx` ON `practice_logs` (`member_id`,`date`);