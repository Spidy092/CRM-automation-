/**
 * Migration 0070: durable workflow enrollments and step history.
 *
 * This migration stores runtime state separately from immutable workflow
 * definitions. The worker and event outbox are intentionally separate steps;
 * applying this migration alone does not enable automatic execution.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createType("workflow_enrollment_status", [
    "active",
    "waiting",
    "paused",
    "completed",
    "failed",
    "exited",
    "cancelled",
  ]);
  pgm.createType("workflow_step_run_status", [
    "queued",
    "running",
    "waiting",
    "succeeded",
    "skipped",
    "failed",
    "cancelled",
  ]);

  pgm.createTable(
    "workflow_enrollments",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      workflow_id: {
        type: "uuid",
        notNull: true,
        references: "workflows",
        onDelete: "RESTRICT",
      },
      workflow_version_id: {
        type: "uuid",
        notNull: true,
        references: "workflow_versions",
        onDelete: "RESTRICT",
      },
      lead_id: {
        type: "uuid",
        notNull: true,
        references: "leads",
        onDelete: "RESTRICT",
      },
      status: {
        type: "workflow_enrollment_status",
        notNull: true,
        default: "active",
      },
      current_node_id: { type: "varchar(80)", notNull: true },
      trigger_event_id: { type: "varchar(255)", notNull: true },
      trigger_event_type: { type: "varchar(100)", notNull: true },
      context: {
        type: "jsonb",
        notNull: true,
        default: pgm.func("'{}'::jsonb"),
      },
      next_run_at: { type: "timestamptz" },
      lock_version: { type: "integer", notNull: true, default: 0 },
      locked_at: { type: "timestamptz" },
      locked_by: { type: "varchar(100)" },
      last_error: { type: "text" },
      enrolled_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
      finished_at: { type: "timestamptz" },
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
    },
    {
      constraints: {
        workflow_enrollment_lock_version_check: "CHECK (lock_version >= 0)",
        workflow_enrollment_event_unique:
          "UNIQUE (workflow_id, trigger_event_id)",
      },
    },
  );
  pgm.createIndex("workflow_enrollments", ["status", "next_run_at"], {
    name: "idx_workflow_enrollments_due",
  });
  pgm.createIndex("workflow_enrollments", ["lead_id", "status"], {
    name: "idx_workflow_enrollments_lead_status",
  });
  pgm.createIndex("workflow_enrollments", ["workflow_id", "lead_id"], {
    name: "idx_workflow_enrollments_workflow_lead",
    where: "status IN ('active', 'waiting', 'paused')",
    unique: true,
  });

  pgm.createTable(
    "workflow_step_runs",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      enrollment_id: {
        type: "uuid",
        notNull: true,
        references: "workflow_enrollments",
        onDelete: "CASCADE",
      },
      node_id: { type: "varchar(80)", notNull: true },
      node_type: { type: "varchar(30)", notNull: true },
      status: {
        type: "workflow_step_run_status",
        notNull: true,
        default: "queued",
      },
      attempt: { type: "integer", notNull: true, default: 1 },
      idempotency_key: { type: "varchar(255)", notNull: true, unique: true },
      job_id: { type: "varchar(255)" },
      input: { type: "jsonb" },
      result: { type: "jsonb" },
      error_code: { type: "varchar(100)" },
      error_message: { type: "text" },
      started_at: { type: "timestamptz" },
      finished_at: { type: "timestamptz" },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
    },
    {
      constraints: {
        workflow_step_run_attempt_check: "CHECK (attempt >= 1)",
        workflow_step_run_identity_unique:
          "UNIQUE (enrollment_id, node_id, attempt)",
      },
    },
  );
  pgm.createIndex("workflow_step_runs", ["enrollment_id", "created_at"], {
    name: "idx_workflow_step_runs_enrollment_created",
    order: { created_at: "DESC" },
  });
  pgm.createIndex("workflow_step_runs", "status", {
    name: "idx_workflow_step_runs_status",
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable("workflow_step_runs");
  pgm.dropTable("workflow_enrollments");
  pgm.dropType("workflow_step_run_status");
  pgm.dropType("workflow_enrollment_status");
};
