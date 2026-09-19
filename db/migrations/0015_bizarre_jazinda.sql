ALTER TABLE `bin` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `bin` ADD `fill_level` integer;--> statement-breakpoint
ALTER TABLE `bin` ADD `description` text;--> statement-breakpoint
ALTER TABLE `bin` ADD `art_prompt` text;--> statement-breakpoint
ALTER TABLE `bin` ADD `label_art_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `bin_handle` ON `bin` (`handle`);--> statement-breakpoint
ALTER TABLE `location` ADD `span` integer;--> statement-breakpoint
ALTER TABLE `box_size` ADD `icon` text;