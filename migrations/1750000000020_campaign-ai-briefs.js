/**
 * Migration: 1750000000020 — Campaign AI Briefs
 *
 * AI-generated strategy brief produced before a campaign launches.
 * One row per campaign. Managers must approve before status moves to 'active'.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('campaign_ai_briefs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    campaign_id: {
      type: 'uuid',
      notNull: true,
      references: '"campaigns"',
      onDelete: 'CASCADE',
      unique: true,
    },
    total_leads_evaluated: {
      type: 'integer',
    },
    eligible_leads: {
      type: 'integer',
    },
    high_fit_leads: {
      type: 'integer',
    },
    segment_summary: {
      type: 'text',
    },
    recommended_offer_angle: {
      type: 'text',
    },
    expected_objections: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    risk_warnings: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    recommended_sequence: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    template_suggestions: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    recommended_autonomy_level: {
      type: 'varchar(20)',
    },
    confidence_score: {
      type: 'integer',
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: "'draft'",
    },
    approved_by: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
    },
    approved_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.addConstraint('campaign_ai_briefs', 'campaign_ai_briefs_status_check',
    "CHECK (status IN ('draft', 'approved', 'rejected'))");
  pgm.addConstraint('campaign_ai_briefs', 'campaign_ai_briefs_autonomy_check',
    "CHECK (recommended_autonomy_level IS NULL OR recommended_autonomy_level IN ('supervised', 'guarded', 'autopilot'))");
  pgm.addConstraint('campaign_ai_briefs', 'campaign_ai_briefs_confidence_check',
    'CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100))');

  pgm.createIndex('campaign_ai_briefs', 'campaign_id');
  pgm.createIndex('campaign_ai_briefs', 'status');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('campaign_ai_briefs');
};
