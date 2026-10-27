ALTER TABLE `goals` ADD `current` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `rewards` ADD `owner_id` text REFERENCES members(id);