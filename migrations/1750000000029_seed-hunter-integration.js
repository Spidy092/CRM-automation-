/* eslint-disable camelcase */

/**
 * Migration: Seed — Hunter Integration
 * Registers the Hunter.io API integration for 1-click email enrichment.
 */

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO integrations (name, display_name, is_enabled)
    VALUES ('hunter', 'Hunter.io', FALSE)
    ON CONFLICT (name) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM integrations WHERE name = 'hunter'`);
};
