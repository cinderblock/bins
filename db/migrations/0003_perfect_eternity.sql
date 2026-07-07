ALTER TABLE `bin` ADD `primary_thumb_hash` text;--> statement-breakpoint
ALTER TABLE `bin_entry` ADD `thumb_hash` text;--> statement-breakpoint
ALTER TABLE `bin_entry` ADD `original_hash` text;