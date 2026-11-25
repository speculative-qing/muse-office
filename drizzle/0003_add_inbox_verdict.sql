ALTER TABLE `inbox_items` ADD COLUMN `verdict` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
UPDATE `inbox_items` SET `verdict` = 'approved' WHERE `decided` = 1;
