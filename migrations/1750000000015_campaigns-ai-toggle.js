/**
 * Migration: 1750000000015 — Add ai_personalization_enabled to campaigns
 *
 * Adds an opt-in per-campaign AI personalization toggle.
 * Defaults to false so existing campaigns are unaffected.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumn('campaigns', {
    ai_personalization_enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropColumn('campaigns', 'ai_personalization_enabled');
};
