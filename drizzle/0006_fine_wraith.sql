CREATE TABLE `saved_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`ingredients` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
