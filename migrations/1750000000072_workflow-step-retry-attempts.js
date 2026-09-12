/**
 * Migration 0072: allow logical workflow step idempotency keys to span retries.
 *
 * workflow_step_runs already has the durable identity constraint
 * (enrollment_id, node_id, attempt). The original migration also made the
 * logical idempotency_key globally unique, which prevented a failed node from
 * recording a second attempt while preserving the same provider idempotency
 * key. Attempts now use the existing identity constraint; the key remains
 * stable across attempts for safe side-effect deduplication.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.sql(`
    ALTER TABLE workflow_step_runs
    DROP CONSTRAINT IF EXISTS workflow_step_runs_idempotency_key_key
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT idempotency_key
        FROM workflow_step_runs
        GROUP BY idempotency_key
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'Cannot restore unique workflow step idempotency keys while retry attempts exist';
      END IF;

      ALTER TABLE workflow_step_runs
      ADD CONSTRAINT workflow_step_runs_idempotency_key_key UNIQUE (idempotency_key);
    END $$
  `);
};
