CREATE TABLE `allowance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`cents` integer NOT NULL,
	`kind` text NOT NULL,
	`stars` integer,
	`ref_id` text,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `allowance_transactions_member_idx` ON `allowance_transactions` (`member_id`);