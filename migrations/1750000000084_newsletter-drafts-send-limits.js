/** Server drafts and durable, cross-broadcast rolling frequency limits.
 * Apply only after approval; no existing migration is modified.
 */
exports.up = (pgm) => {
  pgm.createTable('newsletter_drafts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    content: { type: 'jsonb', notNull: true },
    revision: { type: 'integer', notNull: true, default: 1 },
    status: { type: 'varchar(16)', notNull: true, default: 'draft' },
    created_by: { type: 'uuid', notNull: true },
    broadcast_id: { type: 'varchar(128)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('newsletter_drafts', 'newsletter_draft_status', {
    check: "status IN ('draft', 'sending', 'sent')",
  });
  pgm.createIndex('newsletter_drafts', ['status', 'updated_at']);
  pgm.addColumns('newsletter_subscribers', {
    newsletter_last_accepted_at: { type: 'timestamptz' },
    newsletter_reserved_until: { type: 'timestamptz' },
    newsletter_reservation_key: { type: 'varchar(128)' },
  });
  // Existing accepted/unknown history counts toward the cap at rollout.
  pgm.sql(`UPDATE newsletter_subscribers s SET newsletter_last_accepted_at = r.sent_at
    FROM (SELECT subscriber_id, MAX(created_at) AS sent_at
      FROM newsletter_broadcast_recipients WHERE status IN ('accepted', 'uncertain')
      GROUP BY subscriber_id) r WHERE r.subscriber_id = s.id`);
};
exports.down = (pgm) => {
  pgm.dropTable('newsletter_drafts');
  pgm.dropColumns('newsletter_subscribers', [
    'newsletter_last_accepted_at', 'newsletter_reserved_until', 'newsletter_reservation_key',
  ]);
};
