/**
 * Migration: 1750000000063 — Convert user_availability start_time and end_time to TIME data type
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.sql(`
    ALTER TABLE user_availability
      ALTER COLUMN start_time TYPE TIME USING start_time::TIME,
      ALTER COLUMN end_time TYPE TIME USING end_time::TIME;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.sql(`
    ALTER TABLE user_availability
      ALTER COLUMN start_time TYPE VARCHAR(5) USING to_char(start_time, 'HH24:MI'),
      ALTER COLUMN end_time TYPE VARCHAR(5) USING to_char(end_time, 'HH24:MI');
  `);
};
