CREATE TABLE `saved_drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`data` text NOT NULL,
	`thumb` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_drawings_member_idx` ON `saved_drawings` (`member_id`);