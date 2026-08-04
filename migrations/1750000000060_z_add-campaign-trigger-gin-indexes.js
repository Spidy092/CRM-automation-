/**
 * Migration: 1750000000060 — Add GIN indexes on campaign trigger arrays
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_trigger_source_gin ON campaigns USING GIN (trigger_source);
    CREATE INDEX IF NOT EXISTS idx_campaigns_trigger_tags_gin ON campaigns USING GIN (trigger_tags);
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_campaigns_trigger_source_gin;
    DROP INDEX IF EXISTS idx_campaigns_trigger_tags_gin;
  `);
};
