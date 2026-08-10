CREATE TABLE `client_error` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`device_id` text,
	`fingerprint` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`route` text,
	`build_sha` text,
	`user_agent` text,
	`count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_error_group` ON `client_error` (`group_id`);--> statement-breakpoint
CREATE INDEX `client_error_fingerprint` ON `client_error` (`group_id`,`fingerprint`);