/**
 * Migration: 1750000000051 — Newsletter Subscribers
 *
 * Adds the subscriber lifecycle table for the newsletter feature: public
 * subscribe (double opt-in), one-click unsubscribe, and preference center
 * (topics/frequency). Newsletter issue authoring/bulk-send and bounce
 * handling are deferred to a follow-up and have no schema here.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createType('newsletter_subscriber_status', ['pending', 'confirmed', 'unsubscribed']);
  pgm.createType('newsletter_frequency', ['daily', 'weekly', 'monthly']);

  pgm.createTable('newsletter_subscribers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(255)', notNull: true },
    status: { type: 'newsletter_subscriber_status', notNull: true, default: 'pending' },
    topics: { type: 'jsonb', notNull: true, default: pgm.func("'[]'::jsonb") },
    frequency: { type: 'newsletter_frequency', notNull: true, default: 'weekly' },
    // Persisted (not Redis/TTL) because unsubscribe/preference-center links in
    // email footers must keep working indefinitely, unlike the short-lived
    // confirm token which is stored in Redis with a TTL.
    unsubscribe_token_hash: { type: 'varchar(64)', notNull: true },
    source: { type: 'varchar(50)', notNull: false },
    confirmed_at: { type: 'timestamptz' },
    unsubscribed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(`CREATE UNIQUE INDEX idx_newsletter_subscribers_email ON newsletter_subscribers (lower(email))`);
  pgm.createIndex('newsletter_subscribers', 'status');
  pgm.createIndex('newsletter_subscribers', 'unsubscribe_token_hash', {
    name: 'idx_newsletter_subscribers_unsub_token',
    unique: true,
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('newsletter_subscribers');
  pgm.dropType('newsletter_frequency');
  pgm.dropType('newsletter_subscriber_status');
};
