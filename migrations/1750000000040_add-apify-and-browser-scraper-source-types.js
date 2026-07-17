/**
 * Migration 0040: Add 'apify_actor' and 'browser_scrape' to the scraper_source_type ENUM.
 *
 * Backs the new Apify-actor and headless-Chrome (puppeteer-core) scraper
 * sources — the DB enum must match backend/src/modules/scraper/scraper.types.ts
 * or scraper_configs inserts fail with "invalid input value for enum".
 */

exports.up = async (pgm) => {
  pgm.sql(`ALTER TYPE scraper_source_type ADD VALUE IF NOT EXISTS 'apify_actor';`);
  pgm.sql(`ALTER TYPE scraper_source_type ADD VALUE IF NOT EXISTS 'browser_scrape';`);
};

exports.down = async () => {
  // PostgreSQL does not support removing values from an ENUM type.
  // No-op — the added enum values remain but are simply unused if reverted.
};
