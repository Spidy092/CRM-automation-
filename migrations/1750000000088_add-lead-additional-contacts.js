/** Optional contact methods for a lead. Existing primary contacts remain unchanged. */
exports.up = (pgm) => {
  // IF NOT EXISTS covers databases where this change was applied under an earlier migration name.
  pgm.sql("ALTER TABLE leads ADD COLUMN IF NOT EXISTS additional_emails text[] NOT NULL DEFAULT '{}'::text[]");
  pgm.sql("ALTER TABLE leads ADD COLUMN IF NOT EXISTS additional_phones text[] NOT NULL DEFAULT '{}'::text[]");
};

exports.down = () => {
  throw new Error('Removing additional lead contacts would discard saved data; review before rollback.');
};
