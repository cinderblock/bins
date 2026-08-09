CREATE TABLE `box_size` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`length_mm` integer,
	`width_mm` integer,
	`height_mm` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`field_clocks` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `box_size_group` ON `box_size` (`group_id`);--> statement-breakpoint
ALTER TABLE `bin` ADD `size_id` text;