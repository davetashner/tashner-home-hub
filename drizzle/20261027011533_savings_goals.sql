CREATE TABLE `savings_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`title` text NOT NULL,
	`emoji` text,
	`target_cents` integer NOT NULL,
	`current` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`bought_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_goals_member_idx` ON `savings_goals` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `savings_goals_one_current_idx` ON `savings_goals` (`member_id`) WHERE "savings_goals"."current" = 1;