ALTER TABLE `bin` ADD `location_id` text;--> statement-breakpoint
ALTER TABLE `bin` ADD `slot` text;--> statement-breakpoint
ALTER TABLE `location` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `location` ADD `cols` integer;--> statement-breakpoint
ALTER TABLE `location` ADD `rows` integer;