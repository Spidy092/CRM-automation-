/**
 * Migration 0043: Add scraper_log_id to leads.
 *
 * Links each lead back to the specific scraper run that created it, so a
 * run's results can be drilled into from the Scraper Sources page instead of
 * only seeing aggregate counts. Nullable — manually created / non-scraper
 * leads have no run to link to. ON DELETE SET NULL so deleting old run
 * history never cascades into deleting leads.
 */

exports.up = (pgm) => {
  pgm.addColumn('leads', {
    scraper_log_id: {
      type: 'uuid',
      notNull: false,
      references: '"scraper_logs"',
      onDelete: 'SET NULL',
    },
  });
  pgm.createIndex('leads', 'scraper_log_id', { name: 'idx_leads_scraper_log_id' });
};

exports.down = (pgm) => {
  pgm.dropColumn('leads', 'scraper_log_id');
};
