/**
 * Migration: 1750000000079 — Newsletter Broadcast History (PROPOSED — NOT RUN)
 *
 * Presents durable persistence for newsletter broadcasts so history survives
 * Redis TTL eviction and supports per-recipient delivery states. Requires
 * explicit approval before running (`npm run migrate`); the current
 * implementation reads history from Redis worker outcome records instead.
 *
 * Tables:
 *   newsletter_broadcasts — one row per broadcast job (subject, targeting,
 *     schedule, timezone, aggregate accepted/failed counts, status).
 *   newsletter_broadcast_recipients — per-recipient outcome (accepted/failed/
 *     skipped + provider channel + error) for actionable failure views.
 *     No raw tokens or hashes stored here.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createType('newsletter_broadcast_status', [
    'draft',
    'scheduled',
    'processing',
    'completed',
    'partially_failed',
    'failed',
  ]);

  pgm.createTable('newsletter_broadcasts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    subject: { type: 'varchar(255)', notNull: true },
    preview_text: { type: 'varchar(300)' },
    topics: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    frequency: { type: 'newsletter_frequency' },
    timezone: { type: 'varchar(64)', notNull: true, default: 'UTC' },
    scheduled_at: { type: 'timestamptz' },
    status: { type: 'newsletter_broadcast_status', notNull: true, default: 'draft' },
    attempted: { type: 'integer', notNull: true, default: 0 },
    accepted: { type: 'integer', notNull: true, default: 0 },
    failed: { type: 'integer', notNull: true, default: 0 },
    skipped: { type: 'integer', notNull: true, default: 0 },
    created_by: { type: 'uuid' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('newsletter_broadcast_recipients', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    broadcast_id: {
      type: 'uuid',
      notNull: true,
      references: 'newsletter_broadcasts(id)',
      onDelete: 'CASCADE',
    },
    subscriber_id: {
      type: 'uuid',
      notNull: true,
      references: 'newsletter_subscribers(id)',
      onDelete: 'CASCADE',
    },
    status: { type: 'varchar(20)', notNull: true, default: 'skipped' },
    channel: { type: 'varchar(20)' },
    error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('newsletter_broadcasts', 'status');
  pgm.createIndex('newsletter_broadcasts', 'created_at');
  pgm.createIndex('newsletter_broadcast_recipients', 'broadcast_id');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('newsletter_broadcast_recipients');
  pgm.dropTable('newsletter_broadcasts');
  pgm.dropType('newsletter_broadcast_status');
};
