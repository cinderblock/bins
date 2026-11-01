CREATE TABLE `report` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`device_id` text,
	`reporter_name` text NOT NULL,
	`trust` text DEFAULT 'member' NOT NULL,
	`text` text NOT NULL,
	`route` text,
	`build_sha` text,
	`user_agent` text,
	`context` text,
	`screenshot_hash` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`fixed_in_build` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `report_group_status_idx` ON `report` (`group_id`,`status`);--> statement-breakpoint
CREATE INDEX `report_device_idx` ON `report` (`device_id`);