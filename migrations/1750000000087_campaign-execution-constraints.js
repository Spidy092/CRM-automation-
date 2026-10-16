/**
 * Migration 0087: restore campaign execution integrity constraints.
 *
 * Restore campaign execution constraints omitted by earlier named constraint
 * maps. node-pg-migrate expects constraint options, not a name-to-SQL map.
 * Without these UNIQUE constraints the execution repositories' ON CONFLICT
 * operations fail even after a successful migration chain.
 *
 * Existing invalid/duplicate rows intentionally fail validation; never delete
 * or merge customer records automatically. Review before applying.
 */

const constraints = [
  ['campaign_leads', 'unique_campaign_lead', 'UNIQUE (campaign_id, lead_id)'],
  ['campaign_sequence_snapshots', 'unique_campaign_snapshot_version', 'UNIQUE (campaign_id, version)'],
  ['campaign_sequence_snapshots', 'campaign_sequence_snapshots_steps_array_check', "CHECK (jsonb_typeof(steps) = 'array')"],
  ['campaign_step_executions', 'campaign_step_executions_state_check', "CHECK (state IN ('unscheduled', 'scheduled', 'claimed', 'sent', 'failed', 'uncertain', 'skipped'))"],
  ['campaign_step_executions', 'campaign_step_executions_attempts_check', 'CHECK (attempts >= 0)'],
  ['campaign_day_capacity', 'unique_campaign_day', 'UNIQUE (campaign_id, local_date)'],
  ['campaign_day_capacity', 'campaign_day_capacity_limit_check', 'CHECK (send_limit > 0)'],
  ['campaign_day_capacity', 'campaign_day_capacity_reserved_check', 'CHECK (reserved >= 0)'],
];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  // All interpolated identifiers/definitions are fixed migration constants.
  // Existing named constraints are retained for environments repaired earlier.
  for (const [table, name, definition] of constraints) {
    pgm.sql(`DO $campaign_constraints$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '${table}'::regclass AND conname = '${name}'
        ) THEN
          ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ${definition};
        END IF;
      END
    $campaign_constraints$;`);
  }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  // Retain integrity constraints during application rollback. They may have
  // existed before this migration and remain required by older repositories.
  pgm.sql('SELECT 1;');
};
