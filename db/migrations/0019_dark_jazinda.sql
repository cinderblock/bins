CREATE TABLE `ai_caption` (
	`hash` text NOT NULL,
	`model` text NOT NULL,
	`items` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`hash`, `model`)
);
--> statement-breakpoint
ALTER TABLE `group` ADD `sorting_notes` text;--> statement-breakpoint
ALTER TABLE `bin_entry` ADD `ai_items` text;--> statement-breakpoint
ALTER TABLE `bin_entry` ADD `ai_model` text;--> statement-breakpoint
ALTER TABLE `bin_entry` ADD `ai_photo_hash` text;--> statement-breakpoint
ALTER TABLE `bin_entry` ADD `ai_items_clock` text;