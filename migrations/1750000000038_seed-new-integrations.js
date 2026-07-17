/* eslint-disable camelcase */

/**
 * Migration 0038 — Seed new external integration rows
 *
 * Adds: Mailchimp, Stripe, Zapier, LinkedIn, Telegram
 * Append-only — do NOT edit after deployment.
 */

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO integrations (name, display_name, is_enabled)
    VALUES
      ('mailchimp', 'Mailchimp',  FALSE),
      ('stripe',    'Stripe',     FALSE),
      ('zapier',    'Zapier',     FALSE),
      ('linkedin',  'LinkedIn',   FALSE),
      ('telegram',  'Telegram',   FALSE)
    ON CONFLICT (name) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM integrations
    WHERE name IN ('mailchimp', 'stripe', 'zapier', 'linkedin', 'telegram')
  `);
};
