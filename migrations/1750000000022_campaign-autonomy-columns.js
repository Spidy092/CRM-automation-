/**
 * Migration: 1750000000022 — Campaign Autonomy Columns
 *
 * Adds per-campaign AI autonomy config:
 *   - autonomy_level: 'supervised' | 'guarded' | 'autopilot' (default 'guarded')
 *   - ai_min_confidence: 0–100 (default 70) — threshold for autonomous action
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumns('campaigns', {
    autonomy_level: {
      type: 'varchar(20)',
      notNull: true,
      default: "'guarded'",
    },
    ai_min_confidence: {
      type: 'integer',
      notNull: true,
      default: 70,
    },
  });

  pgm.addConstraint('campaigns', 'campaigns_autonomy_level_check',
    "CHECK (autonomy_level IN ('supervised', 'guarded', 'autopilot'))");
  pgm.addConstraint('campaigns', 'campaigns_ai_min_confidence_check',
    'CHECK (ai_min_confidence >= 0 AND ai_min_confidence <= 100)');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropConstraint('campaigns', 'campaigns_autonomy_level_check');
  pgm.dropConstraint('campaigns', 'campaigns_ai_min_confidence_check');
  pgm.dropColumns('campaigns', ['autonomy_level', 'ai_min_confidence']);
};
