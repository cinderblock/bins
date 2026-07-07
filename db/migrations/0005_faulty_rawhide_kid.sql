ALTER TABLE `device` ADD `kind` text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE `device` ADD `scope` text;--> statement-breakpoint
ALTER TABLE `device` ADD `allowed_origins` text;--> statement-breakpoint
ALTER TABLE `device` ADD `token_prefix` text;