CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`label` text NOT NULL,
	`registered_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkey_group` ON `passkey` (`group_id`);--> statement-breakpoint
ALTER TABLE `device` ADD `admin_until` integer;