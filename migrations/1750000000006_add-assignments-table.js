/* eslint-disable camelcase */

/**
 * Migration: Add Assignments Table
 * Creates the assignments table and assignment_config table
 * for the Round Robin assignment engine.
 */

exports.up = (pgm) => {
  // ── ENUM Types ───────────────────────────────────────────────────────────────
  pgm.createType('assignment_type', ['round_robin', 'manual', 'override']);

  // ── TABLE: assignment_config ─────────────────────────────────────────────────
  pgm.createTable('assignment_config', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    is_enabled:       { type: 'boolean', notNull: true, default: true },
    threshold_score:  { type: 'integer', notNull: true, default: 70, check: 'threshold_score >= 0 AND threshold_score <= 100' },
    eligible_roles:   { type: 'text[]', notNull: true, default: "'{sales_rep}'" },
    updated_by:       { type: 'uuid', references: '"users"' },
    updated_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.sql(`CREATE UNIQUE INDEX idx_assignment_config_singleton ON assignment_config ((TRUE))`);

  // ── TABLE: assignments ───────────────────────────────────────────────────────
  pgm.createTable('assignments', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    lead_id:          { type: 'uuid', notNull: true, references: '"leads"', onDelete: 'CASCADE' },
    assigned_to:      { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    assigned_by:      { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    assignment_type:  { type: 'assignment_type', notNull: true },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('assignments', 'lead_id', { name: 'idx_assignments_lead_id' });
  pgm.createIndex('assignments', 'assigned_to', { name: 'idx_assignments_assigned_to' });
  pgm.sql(`CREATE INDEX idx_assignments_created_at ON assignments (created_at DESC)`);

  // ── Trigger for assignment_config ────────────────────────────────────────────
  pgm.sql(`
    CREATE TRIGGER trg_assignment_config_updated_at
      BEFORE UPDATE ON assignment_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_assignment_config_updated_at ON assignment_config');
  pgm.dropTable('assignments');
  pgm.dropTable('assignment_config');
  pgm.dropType('assignment_type');
};
