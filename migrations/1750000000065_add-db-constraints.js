/**
 * Migration 0065: Add missing database constraints
 *
 * - api_keys.key_hash: UNIQUE constraint (each key hash must be unique)
 * - bookings.status: CHECK constraint for valid status values
 * - form_submissions.status: CHECK constraint for valid status values
 */

exports.up = async (pgm) => {
  // ── 1. UNIQUE constraint on api_keys.key_hash ──────────────────────────
  await pgm.sql(`
    ALTER TABLE api_keys
      ADD CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash)
  `);

  // ── 2. CHECK constraint on bookings.status ─────────────────────────────
  await pgm.sql(`
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_status_check
        CHECK (status IN ('confirmed', 'pending', 'cancelled', 'completed', 'no_show'))
  `);

  // ── 3. CHECK constraint on form_submissions.status ─────────────────────
  await pgm.sql(`
    ALTER TABLE form_submissions
      ADD CONSTRAINT form_submissions_status_check
        CHECK (status IN ('submitted', 'processed', 'spam', 'archived'))
  `);
};

exports.down = async (pgm) => {
  await pgm.sql(`ALTER TABLE form_submissions DROP CONSTRAINT IF EXISTS form_submissions_status_check`);
  await pgm.sql(`ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check`);
  await pgm.sql(`ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_key_hash_unique`);
};
