/**
 * Migration 0048: Add duplicate_lead_ids to scraper_logs.
 *
 * The "View leads" drilldown on a run only showed newly-created leads —
 * records the scraper matched to an existing lead (duplicates) were counted
 * but never identified. This column stores the IDs of the existing leads
 * each duplicate matched, so the drilldown can show "already existed" leads
 * alongside "new" ones.
 */

exports.up = (pgm) => {
  pgm.addColumn('scraper_logs', {
    duplicate_lead_ids: { type: 'uuid[]', notNull: true, default: '{}' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('scraper_logs', 'duplicate_lead_ids');
};
