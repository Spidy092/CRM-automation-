/**
 * Migration: 1750000000081 — Newsletter Subscriber Tokens (PROPOSED — NOT RUN)
 *
 * Append-only multi-token storage for unsubscribe/preference links.
 *
 * Problem: `newsletter_subscribers.unsubscribe_token_hash` holds a single
 * hash that the broadcast worker overwrites on every send. Each rotation
 * invalidates the links in all previously sent legitimate emails.
 *
 * Fix: every send appends a new row here (hash only, never the raw token)
 * and old rows stay valid, so links from any past broadcast keep working.
 * Rows are never updated or deleted by the worker; revocation is an
 * explicit admin operation (see `revoked_at`), not a side effect of
 * sending. Requires explicit approval before running (`npm run migrate`);
 * until then the service falls back to the single-hash column (degraded
 * mode, documented in newsletter.repository.ts).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('newsletter_subscriber_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    subscriber_id: {
      type: 'uuid',
      notNull: true,
      references: 'newsletter_subscribers(id)',
      onDelete: 'CASCADE',
    },
    // SHA-256 hex of the raw bearer token. Raw values are never persisted.
    token_hash: { type: 'varchar(64)', notNull: true },
    // BullMQ job id (or idempotency key) of the broadcast that issued it.
    label: { type: 'varchar(128)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    // Explicit admin revocation only. NULL = valid indefinitely.
    revoked_at: { type: 'timestamptz' },
  });

  pgm.createIndex('newsletter_subscriber_tokens', 'token_hash', {
    name: 'idx_newsletter_subscriber_tokens_hash',
    unique: true,
  });
  pgm.createIndex('newsletter_subscriber_tokens', 'subscriber_id', {
    name: 'idx_newsletter_subscriber_tokens_subscriber',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('newsletter_subscriber_tokens');
};
