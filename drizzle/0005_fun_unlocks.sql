CREATE TABLE `fun_unlocks` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`day` text NOT NULL,
	`unlocked_by` text NOT NULL,
	`unlocked_by_name` text NOT NULL,
	`unlocked_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fun_unlocks_member_day_idx` ON `fun_unlocks` (`member_id`,`day`);
