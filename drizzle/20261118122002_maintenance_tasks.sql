CREATE TABLE `maintenance_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`interval_months` integer,
	`next_due` text,
	`last_done` text,
	`est_time` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
