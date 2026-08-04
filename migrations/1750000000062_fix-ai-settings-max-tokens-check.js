/**
 * Migration: 1750000000062 — Relax AI settings max_tokens cap constraint
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.dropConstraint('ai_settings', 'ai_settings_max_tokens_cap_check', { ifExists: true });
  pgm.addConstraint(
    'ai_settings',
    'ai_settings_max_tokens_cap_check',
    'CHECK (max_tokens >= 1 AND max_tokens <= 16000)'
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropConstraint('ai_settings', 'ai_settings_max_tokens_cap_check', { ifExists: true });
  pgm.addConstraint(
    'ai_settings',
    'ai_settings_max_tokens_cap_check',
    'CHECK (max_tokens <= 500)'
  );
};
