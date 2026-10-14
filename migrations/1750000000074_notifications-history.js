/**
 * Migration 0074: durable notification history.
 *
 * Adds a `notifications` table that stores each recipient's copy of a
 * notification with persistent read and dismissed states.  This enables
 * history that survives page refreshes, API restarts, and Redis outages;
 * the SSE channel remains a live-delivery optimisation only.
 *
 * Design notes:
 * - `idempotency_key` is `<event-occurrence-id>:<recipient_user_id>` so
 *   worker retries or duplicate publishes do not create duplicate rows.
 * - `read_at` and `dismissed_at` are separate states.  Dismissal hides the
 *   item from the active inbox without destroying history.
 * - `metadata` is allowlisted at the service layer; the column itself only
 *   validates that the stored value is a JSON object.
 * - Pagination index is on (recipient_user_id, created_at DESC, id) to
 *   support a stable cursor based on (created_at, id).
 * - Unread-count index is a partial index that excludes dismissed rows.
 *
 * This migration is additive and must be reviewed before it is run.
 * Never edit this file after it has been applied to any environment.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createType('notification_type', [
    'lead_assigned',
    'campaign_enrolled',
    'export_ready',
    'job_failed',
    'scraper_complete',
    'lead_scored',
  ]);

  pgm.createTable('notifications', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    recipient_user_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    /**
     * Stable identity for the business event occurrence that generated this
     * notification.  Combined with recipient_user_id it forms the unique
     * constraint that prevents duplicates.
     *
     * Format convention (enforced in service layer):
     *   assignment:<assignmentId>   — unique per assignment record
     *   enroll:<campaignId>:<leadId> — unique per enrollment
     *   export:<jobId>              — unique per export job
     *   scraper:<logId>             — unique per scraper log row
     */
    occurrence_key: {
      type: 'varchar(500)',
      notNull: true,
    },
    type: {
      type: 'notification_type',
      notNull: true,
    },
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    message: {
      type: 'text',
      notNull: true,
    },
    /**
     * Small allowlisted JSON object.  The service layer enforces an
     * allowlist of keys; the column only asserts it is a JSON object.
     * Never store raw tokens, passwords, or unbounded URLs here.
     */
    metadata: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    read_at: {
      type: 'timestamptz',
    },
    dismissed_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Deduplication: one notification per (occurrence, recipient).
  pgm.addConstraint(
    'notifications',
    'notifications_occurrence_key_recipient_uniq',
    'UNIQUE (occurrence_key, recipient_user_id)',
  );

  // Metadata must be a JSON object, not an array or scalar.
  pgm.addConstraint(
    'notifications',
    'notifications_metadata_object_check',
    "CHECK (jsonb_typeof(metadata) = 'object')",
  );

  // Primary inbox / pagination index: newest-first per user.
  pgm.createIndex('notifications', ['recipient_user_id', { name: 'created_at', sort: 'DESC' }, 'id'], {
    name: 'idx_notifications_inbox',
  });

  // Unread count: excludes dismissed items.
  pgm.createIndex('notifications', ['recipient_user_id', 'read_at'], {
    name: 'idx_notifications_unread',
    where: 'dismissed_at IS NULL',
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('notifications');
  pgm.dropType('notification_type');
};
