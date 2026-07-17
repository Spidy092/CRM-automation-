/**
 * Migration 0042: Add records_duplicate column to scraper_logs.
 *
 * Previously, leads that already existed (matched by email/phone dedup) were
 * silently folded into records_imported, so "Found: 5, Imported: 5" could
 * mean only 1 new lead was actually created and 4 were pre-existing matches
 * — indistinguishable from the UI. This column tracks duplicates separately
 * so run stats are accurate.
 */

exports.up = (pgm) => {
  pgm.addColumn('scraper_logs', {
    records_duplicate: { type: 'integer', notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('scraper_logs', 'records_duplicate');
};
