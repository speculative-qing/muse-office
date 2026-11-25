DROP TABLE IF EXISTS `entries`;
--> statement-breakpoint
CREATE TABLE `status_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `detail` text NOT NULL DEFAULT '',
  `is_headline` integer NOT NULL DEFAULT 0,
  `sort` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pipeline_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `platform` text NOT NULL,
  `stage` text NOT NULL,
  `missing` text NOT NULL DEFAULT '',
  `note` text NOT NULL DEFAULT '',
  `sort` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `desks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `subtitle` text NOT NULL DEFAULT '',
  `metrics` text NOT NULL,
  `next_step` text NOT NULL,
  `sort` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbox_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `stakes` text NOT NULL,
  `since` text NOT NULL DEFAULT '',
  `decided` integer NOT NULL DEFAULT 0,
  `sort` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);
