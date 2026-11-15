CREATE TABLE `art_archive` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`image` blob NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `art_archive_member_idx` ON `art_archive` (`member_id`,`created_at`);--> statement-breakpoint
INSERT INTO `art_archive` (`id`, `member_id`, `created_at`, `image`) SELECT `id`, `author_id`, `created_at`, `image` FROM `notes` WHERE `image` IS NOT NULL;
