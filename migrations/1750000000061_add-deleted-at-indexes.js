/**
 * Migration: 1750000000061 — Add deleted_at partial indexes for soft-deleted tables
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_api_keys_deleted_at ON api_keys (deleted_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files (deleted_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_message_snippets_deleted_at ON message_snippets (deleted_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_landing_pages_deleted_at ON landing_pages (deleted_at) WHERE deleted_at IS NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_api_keys_deleted_at;
    DROP INDEX IF EXISTS idx_files_deleted_at;
    DROP INDEX IF EXISTS idx_message_snippets_deleted_at;
    DROP INDEX IF EXISTS idx_landing_pages_deleted_at;
  `);
};
