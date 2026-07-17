/**
 * Migration: 1750000000045 — Fix lead_ai_profiles column defaults
 *
 * Migration 1750000000017 set `buying_intent` and `enrichment_status`
 * defaults as `default: "'unknown'"` / `default: "'pending'"`, which
 * node-pg-migrate quoted again — storing the literal defaults
 * `'''unknown'''` / `'''pending'''` (i.e. the value WITH quote characters
 * included). Those values are not in the respective CHECK constraint
 * allow-lists, so every INSERT relying on either default (e.g.
 * `setEnrichmentStatus` in ai-intelligence.repository.ts, which omits
 * `buying_intent`) has been failing with:
 *   "new row for relation lead_ai_profiles violates check constraint
 *    lead_ai_profiles_buying_intent_check"
 * This has silently blocked AI research from ever completing for any lead
 * since the table was created — same bug class already fixed once for
 * campaigns.autonomy_level in migration 1750000000026.
 *
 * This migration:
 *   1. Resets both defaults to correct, unquoted values.
 *   2. Repairs any existing rows that were backfilled with the malformed
 *      values (defensive — none expected, since the malformed default
 *      would have always failed the CHECK constraint on insert).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  // 1. Correct the column defaults (pgm.func avoids the double-quoting bug).
  pgm.alterColumn('lead_ai_profiles', 'buying_intent', {
    default: pgm.func("'unknown'"),
  });
  pgm.alterColumn('lead_ai_profiles', 'enrichment_status', {
    default: pgm.func("'pending'"),
  });

  // 2. Repair any rows that stored a malformed literal default.
  pgm.sql(`
    UPDATE lead_ai_profiles
    SET buying_intent = 'unknown'
    WHERE buying_intent NOT IN ('high', 'medium', 'low', 'unknown');
  `);
  pgm.sql(`
    UPDATE lead_ai_profiles
    SET enrichment_status = 'pending'
    WHERE enrichment_status NOT IN ('pending', 'running', 'done', 'failed');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function () {
  // No-op: restoring the malformed defaults would re-introduce the bug.
};
