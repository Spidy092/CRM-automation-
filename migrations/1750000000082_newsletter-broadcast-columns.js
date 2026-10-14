/**
 * Migration: 1750000000082 — Newsletter Broadcast Columns (PROPOSED — NOT RUN)
 *
 * Follow-up to 1750000000079 (also pending approval; applied in order).
 * 0079 defined the history tables but omitted the columns the worker and
 * retry flow need:
 *
 * - `newsletter_broadcasts.html_body` — content required to rebuild a
 *   targeted failed-recipient retry after the BullMQ job payload is gone.
 * - `newsletter_broadcasts.idempotency_key` (+ unique index) — database
 *   level double-submit protection to back the BullMQ jobId dedupe.
 * - `newsletter_broadcasts.job_id` — BullMQ job id for operations mapping.
 * - `UNIQUE (broadcast_id, subscriber_id)` on recipients — makes outcome
 *   upserts idempotent under worker concurrency and retries.
 *
 * Requires explicit approval before running (`npm run migrate`); until then
 * the service degrades to Redis-only history (documented in
 * newsletter.service.ts). Never edit 0079; this file only adds.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumn('newsletter_broadcasts', {
    html_body: { type: 'text' },
    idempotency_key: { type: 'varchar(128)' },
    job_id: { type: 'varchar(128)' },
  });
  pgm.createIndex('newsletter_broadcasts', 'idempotency_key', {
    name: 'idx_newsletter_broadcasts_idempotency',
    unique: true,
    where: 'idempotency_key IS NOT NULL',
  });
  pgm.addConstraint('newsletter_broadcast_recipients', 'uq_newsletter_recipient_outcome', {
    unique: ['broadcast_id', 'subscriber_id'],
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropConstraint('newsletter_broadcast_recipients', 'uq_newsletter_recipient_outcome');
  pgm.dropIndex('newsletter_broadcasts', ['idempotency_key'], {
    name: 'idx_newsletter_broadcasts_idempotency',
  });
  pgm.dropColumn('newsletter_broadcasts', 'idempotency_key');
  pgm.dropColumn('newsletter_broadcasts', 'job_id');
  pgm.dropColumn('newsletter_broadcasts', 'html_body');
};
