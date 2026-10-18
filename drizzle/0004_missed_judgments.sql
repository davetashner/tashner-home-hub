CREATE TABLE `missed_judgments` (
	`id` text PRIMARY KEY NOT NULL,
	`chore_id` text NOT NULL,
	`member_id` text NOT NULL,
	`period_key` text NOT NULL,
	`period_end` text NOT NULL,
	`missed` integer NOT NULL,
	`stars_removed` integer DEFAULT 0 NOT NULL,
	`judged_at` integer NOT NULL,
	FOREIGN KEY (`chore_id`) REFERENCES `chores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `missed_judgments_period_idx` ON `missed_judgments` (`chore_id`,`member_id`,`period_key`);
--> statement-breakpoint
CREATE INDEX `missed_judgments_member_end_idx` ON `missed_judgments` (`member_id`,`period_end`);
