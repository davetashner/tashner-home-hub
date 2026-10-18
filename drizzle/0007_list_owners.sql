ALTER TABLE `lists` ADD `owner_id` text REFERENCES members(id) ON DELETE set null;
