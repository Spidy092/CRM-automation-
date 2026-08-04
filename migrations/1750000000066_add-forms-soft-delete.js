/* eslint-disable camelcase */

/**
 * Migration: Add soft-delete column to forms table
 *
 * Why: AGENTS.md mandates soft-deletes via `deleted_at` (never hard-delete records).
 * Currently forms uses hard-deletes (`DELETE FROM forms`), which also cascade-deletes
 * form submissions. This migration adds `deleted_at timestamptz` and a partial index.
 */

exports.up = (pgm) => {
  pgm.addColumns('forms', {
    deleted_at: { type: 'timestamptz' },
  });

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_forms_deleted_at ON forms (deleted_at) WHERE deleted_at IS NULL`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_forms_deleted_at`);
  pgm.dropColumns('forms', ['deleted_at']);
};
