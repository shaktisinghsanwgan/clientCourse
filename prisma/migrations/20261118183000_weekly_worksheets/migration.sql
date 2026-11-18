-- CreateTable
CREATE TABLE `portal_access` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `program_key` VARCHAR(64) NOT NULL DEFAULT 'reignite-8-week',
    `token_hash` VARCHAR(64) NOT NULL,
    `token_enc` VARCHAR(255) NOT NULL,
    `kajabi_contact_id` VARCHAR(64) NULL,
    `portal_url` VARCHAR(512) NULL,
    `kajabi_synced_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portal_access_user_id_key`(`user_id`),
    UNIQUE INDEX `portal_access_token_hash_key`(`token_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `weekly_ratings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `week_number` INTEGER NOT NULL,
    `desire_rating` INTEGER NULL,
    `happiness_rating` INTEGER NULL,
    `connection_rating` INTEGER NULL,
    `status` ENUM('DRAFT', 'SUBMITTED') NOT NULL DEFAULT 'DRAFT',
    `submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `weekly_ratings_user_id_week_number_key`(`user_id`, `week_number`),
    INDEX `weekly_ratings_week_number_idx`(`week_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `weekly_rating_revisions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `rating_id` BIGINT NOT NULL,
    `desire_rating` INTEGER NULL,
    `happiness_rating` INTEGER NULL,
    `connection_rating` INTEGER NULL,
    `status` ENUM('DRAFT', 'SUBMITTED') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `weekly_rating_revisions_rating_id_created_at_idx`(`rating_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `worksheet_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `week_number` INTEGER NOT NULL,
    `worksheet_key` VARCHAR(80) NOT NULL,
    `original_filename` VARCHAR(180) NOT NULL,
    `storage_path` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(80) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `worksheet_files_user_id_week_number_worksheet_key_active_idx`(`user_id`, `week_number`, `worksheet_key`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `checklist_completions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `week_number` INTEGER NOT NULL,
    `item_key` VARCHAR(80) NOT NULL,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `checklist_completions_user_id_week_number_item_key_key`(`user_id`, `week_number`, `item_key`),
    INDEX `checklist_completions_week_number_idx`(`week_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `weekly_worksheet_progress` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `week_number` INTEGER NOT NULL,
    `ratings_completed` BOOLEAN NOT NULL DEFAULT false,
    `checklist_completed` BOOLEAN NOT NULL DEFAULT false,
    `week_completed` BOOLEAN NOT NULL DEFAULT false,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `weekly_worksheet_progress_user_id_week_number_key`(`user_id`, `week_number`),
    INDEX `weekly_worksheet_progress_week_number_idx`(`week_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `portal_access` ADD CONSTRAINT `portal_access_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_ratings` ADD CONSTRAINT `weekly_ratings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_rating_revisions` ADD CONSTRAINT `weekly_rating_revisions_rating_id_fkey` FOREIGN KEY (`rating_id`) REFERENCES `weekly_ratings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `worksheet_files` ADD CONSTRAINT `worksheet_files_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checklist_completions` ADD CONSTRAINT `checklist_completions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_worksheet_progress` ADD CONSTRAINT `weekly_worksheet_progress_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
