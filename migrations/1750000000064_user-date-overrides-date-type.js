/**
 * Migration: 1750000000064 — Convert user_date_overrides override_date to DATE data type
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.sql(`
    ALTER TABLE user_date_overrides
      ALTER COLUMN override_date TYPE DATE USING override_date::DATE;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.sql(`
    ALTER TABLE user_date_overrides
      ALTER COLUMN override_date TYPE VARCHAR(10) USING to_char(override_date, 'YYYY-MM-DD');
  `);
};
