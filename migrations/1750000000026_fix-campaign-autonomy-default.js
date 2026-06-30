/**
 * Migration: 1750000000026 — Fix campaigns.autonomy_level default
 *
 * Migration 1750000000022 set the column default as `default: "'guarded'"`,
 * which node-pg-migrate quoted again — storing the literal default `'''guarded'''`
 * (i.e. the value `'guarded'` WITH quote characters). That value is not in
 * ('supervised','guarded','autopilot'), so any INSERT relying on the default
 * fails campaigns_autonomy_level_check.
 *
 * This migration:
 *   1. Resets the default to a correct, unquoted 'guarded'.
 *   2. Repairs any existing rows that were backfilled with the malformed value.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  // 1. Correct the column default (PgLiteral avoids the double-quoting bug).
  pgm.alterColumn('campaigns', 'autonomy_level', {
    default: pgm.func("'guarded'"),
  });

  // 2. Repair any rows that stored the malformed literal default.
  pgm.sql(`
    UPDATE campaigns
    SET autonomy_level = 'guarded'
    WHERE autonomy_level NOT IN ('supervised', 'guarded', 'autopilot');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function () {
  // No-op: restoring the malformed default would re-introduce the bug.
};
