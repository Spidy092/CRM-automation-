/**
 * Migration: 1750000000018 — AI Decision Log
 *
 * Append-only audit trail for every AI reasoning step. Every automated
 * decision the AI makes is logged here with its full chain-of-thought,
 * confidence score, and whether human approval was required.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('ai_decision_log', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    lead_id: {
      type: 'uuid',
      references: '"leads"',
      onDelete: 'SET NULL',
    },
    campaign_id: {
      type: 'uuid',
      references: '"campaigns"',
      onDelete: 'SET NULL',
    },
    decision_type: {
      type: 'varchar(50)',
      notNull: true,
    },
    input_context: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
    },
    chain_of_thought: {
      type: 'text',
    },
    decision: {
      type: 'varchar(100)',
      notNull: true,
    },
    confidence: {
      type: 'integer',
    },
    tokens_used: {
      type: 'integer',
    },
    latency_ms: {
      type: 'integer',
    },
    model_used: {
      type: 'varchar(100)',
    },
    autonomy_level: {
      type: 'varchar(20)',
    },
    human_approval_required: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    human_approved_by: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
    },
    human_approved_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.addConstraint('ai_decision_log', 'ai_decision_log_confidence_check',
    'CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))');
  pgm.addConstraint('ai_decision_log', 'ai_decision_log_decision_type_check',
    "CHECK (decision_type IN ('research', 'next_action', 'reply_classify', 'campaign_brief'))");

  pgm.createIndex('ai_decision_log', 'lead_id');
  pgm.createIndex('ai_decision_log', 'campaign_id');
  pgm.createIndex('ai_decision_log', 'decision_type');
  pgm.createIndex('ai_decision_log', 'created_at', { order: 'DESC' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('ai_decision_log');
};
