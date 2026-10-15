/**
 * Migration: 1750000000083 — Newsletter Broadcast Frequencies (PROPOSED — NOT RUN)
 *
 * Follow-up to 1750000000079 (also pending approval; applied in order).
 * 0079's broadcasts table carries a single `frequency` filter, but automated
 * sends target a frequency LIST (the weekly digest serves daily + weekly
 * subscribers while excluding monthly). Without a place to persist that
 * audience definition, digest broadcast rows would read as "any frequency".
 *
 * Adds `newsletter_broadcasts.frequencies` (jsonb array, default `[]`):
 * empty means "no list filter" (single `frequency` column or untargeted
 * applies). Code reads/writes it best-effort so 0079-only databases keep
 * working; the job payload and Redis outcome retain the same data.
 *
 * Requires explicit approval before running (`npm run migrate`).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumn('newsletter_broadcasts', {
    frequencies: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropColumn('newsletter_broadcasts', 'frequencies');
};
