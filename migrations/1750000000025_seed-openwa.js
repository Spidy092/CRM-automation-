/* eslint-disable camelcase */

/**
 * Migration: Seed — OpenWA Integration
 * Registers the OpenWA-based WhatsApp provider in a disabled state.
 * Credentials are configured by an admin via the UI after deployment.
 */

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO integrations (name, display_name, is_enabled)
    VALUES ('openwa', 'OpenWA WhatsApp', FALSE)
    ON CONFLICT (name) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM integrations WHERE name = 'openwa'`);
};
