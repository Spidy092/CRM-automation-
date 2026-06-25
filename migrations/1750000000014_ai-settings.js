/**
 * Migration: 1750000000014 — AI Settings table
 *
 * Creates the `ai_settings` table to store configurable OpenAI-compatible
 * AI settings for message personalization. Supports any OpenAI-compatible
 * provider by allowing a custom base URL, model name, and parameters.
 *
 * Only one row is expected (enforced via `singleton_guard`).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('ai_settings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    // Singleton guard — only one row allowed
    singleton_guard: {
      type: 'boolean',
      notNull: true,
      default: true,
      unique: true,
    },
    // Master switch — when false, outreach falls back to template substitution
    enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    // OpenAI-compatible base URL. Null = use OpenAI default (https://api.openai.com/v1)
    base_url: {
      type: 'text',
      notNull: false,
    },
    // Encrypted API key — decrypted at runtime using shared encryption util
    encrypted_api_key: {
      type: 'text',
      notNull: false,
    },
    // Model identifier (e.g. 'gpt-4o', 'gpt-4-turbo', 'claude-3-opus', 'mixtral-8x7b')
    model: {
      type: 'varchar(255)',
      notNull: true,
      default: 'gpt-4o',
    },
    // Maximum tokens per completion (capped at 2000 to control cost)
    max_tokens: {
      type: 'integer',
      notNull: true,
      default: 500,
    },
    // Temperature 0.0–2.0
    temperature: {
      type: 'numeric(3,2)',
      notNull: true,
      default: 0.7,
    },
    // System prompt override. Null = use the built-in default system prompt
    system_prompt_override: {
      type: 'text',
      notNull: false,
    },
    // Cache TTL in seconds (default 7 days = 604800)
    cache_ttl_seconds: {
      type: 'integer',
      notNull: true,
      default: 604800,
    },
    updated_by: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
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

  // Add constraint: singleton_guard can only be true
  pgm.addConstraint('ai_settings', 'ai_settings_singleton_guard_check', 'CHECK (singleton_guard = true)');

  // Seed the default row (disabled by default — user must configure)
  pgm.sql(`
    INSERT INTO ai_settings (enabled, model, max_tokens, temperature)
    VALUES (false, 'gpt-4o', 500, 0.7)
    ON CONFLICT DO NOTHING
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('ai_settings');
};
