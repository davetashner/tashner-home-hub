CREATE TABLE `sitter_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sitter_name` text,
	`pin_hash` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`ended_at` integer,
	`approve_jobs` integer DEFAULT false NOT NULL,
	`fun_allowed` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
