CREATE TABLE `practice_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`minutes_per_block` integer NOT NULL,
	`stars_per_block` integer NOT NULL,
	`daily_star_cap` integer NOT NULL,
	`member_ids` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `practice_activities` (`id`, `name`, `emoji`, `minutes_per_block`, `stars_per_block`, `daily_star_cap`, `member_ids`, `active`, `sort_order`) VALUES
	('practice-reading', 'Reading', '📖', 15, 1, 4, NULL, 1, 0),
	('practice-practice', 'Practice', '🎵', 15, 1, 4, NULL, 1, 1);
