/**
 * Migration: 1750000000019 — Lead Conversation Summaries
 *
 * Rolling AI-generated summary of all interactions per lead.
 * Regenerated (not appended) after every inbound message using full history.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('lead_conversation_summaries', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    lead_id: {
      type: 'uuid',
      notNull: true,
      references: '"leads"',
      onDelete: 'CASCADE',
      unique: true,
    },
    summary: {
      type: 'text',
      notNull: true,
    },
    last_interaction_at: {
      type: 'timestamptz',
    },
    last_intent_class: {
      type: 'varchar(50)',
    },
    interaction_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    sentiment: {
      type: 'varchar(20)',
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.addConstraint('lead_conversation_summaries', 'lead_conv_summaries_sentiment_check',
    "CHECK (sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative'))");

  pgm.createIndex('lead_conversation_summaries', 'lead_id');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('lead_conversation_summaries');
};
