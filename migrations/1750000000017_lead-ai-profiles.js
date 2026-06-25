/**
 * Migration: 1750000000017 — Lead AI Profiles
 *
 * Creates `lead_ai_profiles` — one row per lead, populated by the AI
 * research worker (aiResearch.worker.ts) after every lead.created /
 * lead.imported event.
 *
 * Fields are append-safe: buying_signals, objection_log, and do_not_say
 * are always updated with JSONB concat, never overwritten wholesale.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('lead_ai_profiles', {
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

    // ── Research fields ─────────────────────────────────────────────────
    website_quality_score: {
      type: 'integer',
    },
    pain_points: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    offer_angle: {
      type: 'text',
    },
    inferred_budget_range: {
      type: 'varchar(20)',
    },

    // ── Intelligence fields ─────────────────────────────────────────────
    buying_intent: {
      type: 'varchar(20)',
      default: "'unknown'",
    },
    reachability_score: {
      type: 'integer',
    },
    buying_signals: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    objection_log: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
    do_not_say: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },

    // ── Preference fields ───────────────────────────────────────────────
    preferred_channel: {
      type: 'varchar(20)',
    },
    preferred_time_of_day: {
      type: 'varchar(20)',
    },

    // ── Memory fields ───────────────────────────────────────────────────
    conversation_summary: {
      type: 'text',
    },
    ai_notes: {
      type: 'text',
    },

    // ── Next action fields ──────────────────────────────────────────────
    next_best_action: {
      type: 'varchar(50)',
    },
    next_best_action_reason: {
      type: 'text',
    },
    next_best_action_confidence: {
      type: 'integer',
    },

    // ── Lifecycle ───────────────────────────────────────────────────────
    enrichment_status: {
      type: 'varchar(20)',
      notNull: true,
      default: "'pending'",
    },
    last_enriched_at: {
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

  pgm.addConstraint('lead_ai_profiles', 'lead_ai_profiles_buying_intent_check',
    "CHECK (buying_intent IN ('high', 'medium', 'low', 'unknown'))");
  pgm.addConstraint('lead_ai_profiles', 'lead_ai_profiles_enrichment_status_check',
    "CHECK (enrichment_status IN ('pending', 'running', 'done', 'failed'))");
  pgm.addConstraint('lead_ai_profiles', 'lead_ai_profiles_website_quality_check',
    'CHECK (website_quality_score IS NULL OR (website_quality_score >= 0 AND website_quality_score <= 100))');
  pgm.addConstraint('lead_ai_profiles', 'lead_ai_profiles_reachability_check',
    'CHECK (reachability_score IS NULL OR (reachability_score >= 0 AND reachability_score <= 100))');
  pgm.addConstraint('lead_ai_profiles', 'lead_ai_profiles_confidence_check',
    'CHECK (next_best_action_confidence IS NULL OR (next_best_action_confidence >= 0 AND next_best_action_confidence <= 100))');
  pgm.addConstraint('lead_ai_profiles', 'lead_ai_profiles_preferred_channel_check',
    "CHECK (preferred_channel IS NULL OR preferred_channel IN ('whatsapp', 'email', 'sms'))");

  pgm.createIndex('lead_ai_profiles', 'lead_id');
  pgm.createIndex('lead_ai_profiles', 'buying_intent');
  pgm.createIndex('lead_ai_profiles', 'next_best_action');
  pgm.createIndex('lead_ai_profiles', 'enrichment_status');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('lead_ai_profiles');
};
