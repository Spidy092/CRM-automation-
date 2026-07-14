/**
 * Migration 0033 — Add activities table and first_contacted_at to leads
 *
 * Creates an audit/activity ledger for lead interactions (calls, WhatsApp,
 * emails, notes, status and assignment changes). Also adds a nullable
 * first_contacted_at timestamp to leads so the UI can surface untouched leads.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createType('activity_type', [
    'call',
    'whatsapp',
    'email',
    'note',
    'status_change',
    'assignment_change',
  ]);

  pgm.createTable('activities', {
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
    },
    user_id: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
    },
    type: {
      type: 'activity_type',
      notNull: true,
    },
    metadata: {
      type: 'jsonb',
      default: '{}',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.createIndex('activities', ['lead_id', 'created_at'], {
    name: 'idx_activities_lead_created',
    order: { created_at: 'DESC' },
  });
  pgm.createIndex('activities', ['user_id', 'created_at'], {
    name: 'idx_activities_user_created',
    order: { created_at: 'DESC' },
    where: 'user_id IS NOT NULL',
  });
  pgm.createIndex('activities', 'type', {
    name: 'idx_activities_type',
  });

  pgm.addColumn('leads', {
    first_contacted_at: {
      type: 'timestamptz',
      notNull: false,
      default: null,
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropColumn('leads', 'first_contacted_at');

  pgm.dropIndex('activities', 'type', { name: 'idx_activities_type', ifExists: true });
  pgm.dropIndex('activities', ['user_id', 'created_at'], {
    name: 'idx_activities_user_created',
    ifExists: true,
  });
  pgm.dropIndex('activities', ['lead_id', 'created_at'], {
    name: 'idx_activities_lead_created',
    ifExists: true,
  });

  pgm.dropTable('activities');
  pgm.dropType('activity_type');
};
