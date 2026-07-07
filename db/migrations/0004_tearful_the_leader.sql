CREATE TABLE `label` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`field_clocks` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `label_group` ON `label` (`group_id`);--> statement-breakpoint
ALTER TABLE `bin` ADD `weight_grams` integer;--> statement-breakpoint
ALTER TABLE `bin` ADD `label_ids` text;