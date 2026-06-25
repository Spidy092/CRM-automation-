/**
 * Migration: Clamp AI settings max_tokens to the Phase 1 cost-control cap.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.sql(`
    UPDATE ai_settings
    SET max_tokens = 500
    WHERE max_tokens > 500
  `);

  pgm.addConstraint(
    'ai_settings',
    'ai_settings_max_tokens_cap_check',
    'CHECK (max_tokens <= 500)'
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropConstraint('ai_settings', 'ai_settings_max_tokens_cap_check');
};
