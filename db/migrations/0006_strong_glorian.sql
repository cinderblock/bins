CREATE TABLE `suggestion` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`bin_id` integer NOT NULL,
	`device_id` text,
	`fields` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by_op_id` text,
	`field_clocks` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suggestion_group_status` ON `suggestion` (`group_id`,`status`);--> statement-breakpoint
CREATE INDEX `suggestion_bin` ON `suggestion` (`bin_id`);