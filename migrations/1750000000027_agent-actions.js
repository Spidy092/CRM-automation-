/**
 * Migration: 1750000000027 — Agent Actions
 *
 * Durable command ledger for AI/chat/event proposed actions. This keeps human
 * approvals, idempotency, execution status, and audit metadata separate from
 * the user-facing ai_inbox_items projection.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('agent_actions', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    source: {
      type: 'varchar(50)',
      notNull: true,
    },
    action_name: {
      type: 'varchar(100)',
      notNull: true,
    },
    action_args: {
      type: 'jsonb',
      notNull: true,
      default: '{}',
    },
    risk_tier: {
      type: 'varchar(40)',
      notNull: true,
    },
    status: {
      type: 'varchar(40)',
      notNull: true,
      default: 'proposed',
    },
    requested_by: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
    },
    requester_role: {
      type: 'varchar(30)',
    },
    requester_email: {
      type: 'varchar(255)',
    },
    requester_name: {
      type: 'varchar(255)',
    },
    approved_by: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
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
    confidence: {
      type: 'integer',
    },
    autonomy_level: {
      type: 'varchar(20)',
    },
    idempotency_key: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    result: {
      type: 'jsonb',
    },
    error_message: {
      type: 'text',
    },
    source_message: {
      type: 'text',
    },
    expires_at: {
      type: 'timestamptz',
    },
    executed_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.addConstraint('agent_actions', 'agent_actions_source_check',
    "CHECK (source IN ('chat', 'event', 'ai_reply', 'ai_decision', 'ai_campaign_brain', 'expiry', 'manual'))");
  pgm.addConstraint('agent_actions', 'agent_actions_risk_tier_check',
    "CHECK (risk_tier IN ('read', 'low_risk_write', 'customer_facing_write', 'sensitive_write', 'compliance_critical', 'unsupported'))");
  pgm.addConstraint('agent_actions', 'agent_actions_status_check',
    "CHECK (status IN ('proposed', 'pending_approval', 'approved', 'rejected', 'executing', 'succeeded', 'failed', 'expired', 'cancelled'))");
  pgm.addConstraint('agent_actions', 'agent_actions_confidence_check',
    'CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100))');

  pgm.addColumn('ai_inbox_items', {
    agent_action_id: {
      type: 'uuid',
      references: '"agent_actions"',
      onDelete: 'SET NULL',
    },
    action_result: {
      type: 'jsonb',
    },
  });

  pgm.createIndex('agent_actions', 'status');
  pgm.createIndex('agent_actions', 'source');
  pgm.createIndex('agent_actions', 'action_name');
  pgm.createIndex('agent_actions', 'lead_id');
  pgm.createIndex('agent_actions', 'campaign_id');
  pgm.createIndex('agent_actions', 'created_at', { order: 'DESC' });
  pgm.createIndex('ai_inbox_items', 'agent_action_id');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropIndex('ai_inbox_items', 'agent_action_id');
  pgm.dropIndex('agent_actions', 'created_at');
  pgm.dropIndex('agent_actions', 'campaign_id');
  pgm.dropIndex('agent_actions', 'lead_id');
  pgm.dropIndex('agent_actions', 'action_name');
  pgm.dropIndex('agent_actions', 'source');
  pgm.dropIndex('agent_actions', 'status');
  pgm.dropColumns('ai_inbox_items', ['agent_action_id', 'action_result']);
  pgm.dropTable('agent_actions');
};
