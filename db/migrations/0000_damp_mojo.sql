CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`access_code_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`display_name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_token_hash_unique` ON `device` (`token_hash`);--> statement-breakpoint
CREATE INDEX `device_group` ON `device` (`group_id`);--> statement-breakpoint
CREATE TABLE `op` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`op_id` text NOT NULL,
	`group_id` text NOT NULL,
	`bin_id` integer,
	`device_id` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`client_time` integer NOT NULL,
	`effective_time` integer NOT NULL,
	`server_time` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`geo_lat` real,
	`geo_lng` real,
	`geo_acc` real,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `op_op_id_unique` ON `op` (`op_id`);--> statement-breakpoint
CREATE INDEX `op_group_seq` ON `op` (`group_id`,`seq`);--> statement-breakpoint
CREATE TABLE `bin` (
	`id` integer PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`status` text DEFAULT 'unclaimed' NOT NULL,
	`name` text,
	`size_class` text,
	`external_label` text,
	`location_name` text,
	`primary_photo_hash` text,
	`field_clocks` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bin_group` ON `bin` (`group_id`);--> statement-breakpoint
CREATE TABLE `bin_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`bin_id` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`photo_hash` text,
	`mime` text,
	`device_id` text,
	`effective_time` integer NOT NULL,
	`geo_lat` real,
	`geo_lng` real,
	`geo_acc` real,
	`deleted_by_op_id` text,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bin_entry_bin` ON `bin_entry` (`bin_id`);--> statement-breakpoint
CREATE INDEX `bin_entry_group` ON `bin_entry` (`group_id`);--> statement-breakpoint
CREATE TABLE `location` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`field_clocks` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `location_group` ON `location` (`group_id`);--> statement-breakpoint
CREATE TABLE `photo_blob` (
	`group_id` text NOT NULL,
	`hash` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`device_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`group_id`, `hash`),
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
