CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`device_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_ok_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_endpoint` ON `push_subscription` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscription_group` ON `push_subscription` (`group_id`);--> statement-breakpoint
CREATE INDEX `push_subscription_device` ON `push_subscription` (`device_id`);