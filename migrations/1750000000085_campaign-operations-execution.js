/**
 * Migration 0085: campaign operations durable execution state.
 *
 * PostgreSQL becomes the source of truth for enrollment progress, next-step
 * timing, and execution identity. BullMQ remains the wake-up transport only.
 *
 * Additive only: new tables plus new nullable/defaulted columns on
 * campaign_leads. Existing rows backfill to neutral values; legacy paused
 * campaigns keep recoverable per-enrollment timing where outreach_logs and
 * queued jobs allow it, otherwise enrollments are marked timing_unknown so
 * the UI shows "unknown timing" instead of a guessed due time.
 *
 * REVIEW REQUIRED BEFORE RUNNING. Never edit this file after it has run;
 * add a new migration instead.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  // Immutable pinned sequence per campaign version. Existing enrollments keep
  // their snapshot; sequence edits mint a new version for future enrollments.
  pgm.createTable('campaign_sequence_snapshots', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    campaign_id: { type: 'uuid', notNull: true, references: '"campaigns"', onDelete: 'CASCADE' },
    sequence_id: { type: 'uuid', notNull: true },
    version: { type: 'integer', notNull: true },
    steps: { type: 'jsonb', notNull: true, default: '[]' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, {
    constraints: {
      unique_campaign_snapshot_version: 'UNIQUE (campaign_id, version)',
      campaign_sequence_snapshots_steps_array_check: 'CHECK (jsonb_typeof(steps) = \'array\')',
    },
  });
  pgm.createIndex('campaign_sequence_snapshots', 'campaign_id', {
    name: 'idx_campaign_sequence_snapshots_campaign_id',
  });

  // Enrollment execution state on the owning campaign_leads rows.
  pgm.addColumns('campaign_leads', {
    enrollment_status: { type: 'varchar(20)', notNull: true, default: 'active' },
    sequence_snapshot_id: { type: 'uuid', references: '"campaign_sequence_snapshots"', onDelete: 'SET NULL' },
    next_step_number: { type: 'integer' },
    next_due_at: { type: 'timestamptz' },
    delay_remaining_ms: { type: 'bigint' },
    completed_steps: { type: 'integer', notNull: true, default: 0 },
    pause_reason: { type: 'text' },
    stop_reason: { type: 'text' },
    scheduling_generation: { type: 'integer', notNull: true, default: 0 },
    timing_unknown: { type: 'boolean', notNull: true, default: false },
    execution_updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint(
    'campaign_leads',
    'campaign_leads_enrollment_status_check',
    "CHECK (enrollment_status IN ('active', 'paused', 'completed', 'stopped'))",
  );
  pgm.createIndex('campaign_leads', ['campaign_id', 'enrollment_status', 'next_due_at'], {
    name: 'idx_campaign_leads_scheduling',
  });

  // Idempotent step execution records. dedupe_key is the opaque stable
  // execution identity (campaign/lead/snapshot/step/generation/attempt);
  // transport jobs carry it plus the generation and must claim the row before
  // sending, so repeats, stale jobs, recovery, and retries cannot double-send.
  pgm.createTable('campaign_step_executions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    campaign_id: { type: 'uuid', notNull: true, references: '"campaigns"', onDelete: 'CASCADE' },
    lead_id: { type: 'uuid', notNull: true, references: '"leads"', onDelete: 'CASCADE' },
    snapshot_id: { type: 'uuid', references: '"campaign_sequence_snapshots"', onDelete: 'SET NULL' },
    step_number: { type: 'integer', notNull: true },
    channel: { type: 'varchar(20)', notNull: true },
    template_id: { type: 'uuid' },
    generation: { type: 'integer', notNull: true, default: 0 },
    dedupe_key: { type: 'varchar(255)', notNull: true, unique: true },
    state: { type: 'varchar(20)', notNull: true, default: 'unscheduled' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    due_at: { type: 'timestamptz' },
    transport_job_id: { type: 'varchar(255)' },
    provider_msg_id: { type: 'varchar(255)' },
    lease_expires_at: { type: 'timestamptz' },
    claimed_by: { type: 'varchar(100)' },
    error_category: { type: 'varchar(50)' },
    error_message: { type: 'text' },
    manual_override: { type: 'boolean', notNull: true, default: false },
    override_provenance: { type: 'text' },
    sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, {
    constraints: {
      campaign_step_executions_state_check:
        "CHECK (state IN ('unscheduled', 'scheduled', 'claimed', 'sent', 'failed', 'uncertain', 'skipped'))",
      campaign_step_executions_attempts_check: 'CHECK (attempts >= 0)',
    },
  });
  pgm.createIndex('campaign_step_executions', ['state', 'due_at', 'created_at'], {
    name: 'idx_campaign_step_executions_claimable',
    where: "state IN ('unscheduled', 'scheduled')",
  });
  pgm.createIndex('campaign_step_executions', ['campaign_id', 'lead_id', 'step_number'], {
    name: 'idx_campaign_step_executions_enrollment',
  });

  // Atomic per-day campaign capacity reservations. Concurrent workers reserve
  // through a single conditional UPDATE so the limit can never overshoot.
  // Uncertain provider outcomes keep their reservation until reviewed;
  // definite failures release it.
  pgm.createTable('campaign_day_capacity', {
    campaign_id: { type: 'uuid', notNull: true, references: '"campaigns"', onDelete: 'CASCADE' },
    local_date: { type: 'date', notNull: true },
    send_limit: { type: 'integer', notNull: true },
    reserved: { type: 'integer', notNull: true, default: 0 },
  }, {
    constraints: {
      unique_campaign_day: 'UNIQUE (campaign_id, local_date)',
      campaign_day_capacity_limit_check: 'CHECK (send_limit > 0)',
      campaign_day_capacity_reserved_check: 'CHECK (reserved >= 0)',
    },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable('campaign_day_capacity');
  pgm.dropTable('campaign_step_executions');
  pgm.dropConstraint('campaign_leads', 'campaign_leads_enrollment_status_check');
  pgm.dropColumns('campaign_leads', [
    'enrollment_status',
    'sequence_snapshot_id',
    'next_step_number',
    'next_due_at',
    'delay_remaining_ms',
    'completed_steps',
    'pause_reason',
    'stop_reason',
    'scheduling_generation',
    'timing_unknown',
    'execution_updated_at',
  ]);
  pgm.dropTable('campaign_sequence_snapshots');
};
