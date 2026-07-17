/* eslint-disable camelcase */

/**
 * Migration 0039 — Seed the Apify integration row
 *
 * Apify is a managed web-scraping platform whose hosted "Actors" power the
 * `apify_actor` scraper source type. Append-only — do NOT edit after deployment.
 */

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO integrations (name, display_name, is_enabled)
    VALUES ('apify', 'Apify', FALSE)
    ON CONFLICT (name) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM integrations
    WHERE name = 'apify'
  `);
};
