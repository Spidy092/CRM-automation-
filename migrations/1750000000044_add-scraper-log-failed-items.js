/**
 * Migration 0044: Add failed_items to scraper_logs.
 *
 * Previously a failed record's raw scraped data was discarded — only a
 * count and a generic warning were logged. This column persists the raw
 * lead data + error reason for each record that failed to import, so a
 * "Retry failed" action can re-attempt just those records without
 * re-scraping the whole source.
 */

exports.up = (pgm) => {
  pgm.addColumn('scraper_logs', {
    failed_items: { type: 'jsonb', notNull: true, default: '[]' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('scraper_logs', 'failed_items');
};
