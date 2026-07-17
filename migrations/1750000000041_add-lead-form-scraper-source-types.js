/**
 * Migration 0041: Add 'meta_lead_forms', 'google_ads_lead_forms', and
 * 'linkedin_lead_forms' to the scraper_source_type ENUM.
 *
 * These source types were already implemented in
 * backend/src/modules/scraper/scraper.service.ts (scrapeMetaLeadForms,
 * scrapeGoogleAdsLeadForms, scrapeLinkedInLeadForms) and scraper.types.ts,
 * but no prior migration added them to the DB enum — creating a
 * scraper_configs row with any of these source_types fails with
 * "invalid input value for enum scraper_source_type". This migration closes
 * that gap (append-only, does not touch migration 0012's original values).
 */

exports.up = async (pgm) => {
  pgm.sql(`ALTER TYPE scraper_source_type ADD VALUE IF NOT EXISTS 'meta_lead_forms';`);
  pgm.sql(`ALTER TYPE scraper_source_type ADD VALUE IF NOT EXISTS 'google_ads_lead_forms';`);
  pgm.sql(`ALTER TYPE scraper_source_type ADD VALUE IF NOT EXISTS 'linkedin_lead_forms';`);
};

exports.down = async () => {
  // PostgreSQL does not support removing values from an ENUM type.
  // No-op — the added enum values remain but are simply unused if reverted.
};
