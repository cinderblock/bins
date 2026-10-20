CREATE TABLE `label_art` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`bin_id` integer NOT NULL,
	`source_hash` text NOT NULL,
	`hash` text NOT NULL,
	`threshold` integer NOT NULL,
	`model` text NOT NULL,
	`variant` text,
	`text_removed` integer,
	`created_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `label_art_bin` ON `label_art` (`group_id`,`bin_id`,`created_at`);