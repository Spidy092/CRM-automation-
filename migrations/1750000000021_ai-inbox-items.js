/**
 * Migration: 1750000000021 — AI Inbox Items
 *
 * Priority task feed for sales reps. AI creates items when a decision
 * requires human attention — reply approval, urgent response, campaign review, etc.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createType('ai_inbox_item_type', [
    'approve_response',
    'urgent_reply',
    'pricing_inquiry',
    'campaign_review',
    'lead_handoff',
    'objection_review',
  ]);

  pgm.createType('ai_inbox_item_status', [
    'pending',
    'actioned',
    'snoozed',
    'auto_resolved',
  ]);

  pgm.createTable('ai_inbox_items', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    assigned_to: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    lead_id: {
      type: 'uuid',
      references: '"leads"',
      onDelete: 'CASCADE',
    },
    campaign_id: {
      type: 'uuid',
      references: '"campaigns"',
      onDelete: 'SET NULL',
    },
    item_type: {
      type: 'ai_inbox_item_type',
      notNull: true,
    },
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    summary: {
      type: 'text',
    },
    urgency_score: {
      type: 'integer',
      notNull: true,
      default: 50,
    },
    ai_draft_response: {
      type: 'text',
    },
    ai_draft_confidence: {
      type: 'integer',
    },
    expires_at: {
      type: 'timestamptz',
    },
    status: {
      type: 'ai_inbox_item_status',
      notNull: true,
      default: pgm.func("'pending'"),
    },
    snoozed_until: {
      type: 'timestamptz',
    },
    actioned_by: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
    },
    actioned_at: {
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

  pgm.addConstraint('ai_inbox_items', 'ai_inbox_items_urgency_check',
    'CHECK (urgency_score >= 0 AND urgency_score <= 100)');
  pgm.addConstraint('ai_inbox_items', 'ai_inbox_items_draft_confidence_check',
    'CHECK (ai_draft_confidence IS NULL OR (ai_draft_confidence >= 0 AND ai_draft_confidence <= 100))');

  pgm.createIndex('ai_inbox_items', 'assigned_to');
  pgm.createIndex('ai_inbox_items', 'status');
  pgm.createIndex('ai_inbox_items', ['assigned_to', 'status']);
  pgm.createIndex('ai_inbox_items', 'urgency_score', { order: 'DESC' });
  pgm.createIndex('ai_inbox_items', 'expires_at');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('ai_inbox_items');
  pgm.dropType('ai_inbox_item_status');
  pgm.dropType('ai_inbox_item_type');
};
