/**
 * Migration 0071: durable domain-event outbox.
 *
 * Business transactions can append an event here before they commit. A later
 * publisher claims rows and delivers them to a queue without losing events
 * when Redis or a worker is temporarily unavailable.
 *
 * This migration is intentionally additive and must be reviewed before it is
 * run. It does not change existing domain tables or wire any producers.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createType("outbox_event_status", [
    "pending",
    "publishing",
    "published",
    "failed",
  ]);

  pgm.createTable(
    "event_outbox",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      event_type: { type: "varchar(150)", notNull: true },
      aggregate_type: { type: "varchar(80)" },
      aggregate_id: { type: "varchar(255)" },
      idempotency_key: { type: "varchar(255)", notNull: true, unique: true },
      payload: { type: "jsonb", notNull: true },
      status: {
        type: "outbox_event_status",
        notNull: true,
        default: "pending",
      },
      attempts: { type: "integer", notNull: true, default: 0 },
      next_attempt_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
      locked_at: { type: "timestamptz" },
      locked_by: { type: "varchar(100)" },
      published_at: { type: "timestamptz" },
      last_error: { type: "text" },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
    },
    {
      constraints: {
        event_outbox_attempts_check: "CHECK (attempts >= 0)",
        event_outbox_payload_object_check:
          "CHECK (jsonb_typeof(payload) = 'object')",
      },
    },
  );

  // Claiming uses this index; the partial predicate excludes terminal rows.
  pgm.createIndex("event_outbox", ["status", "next_attempt_at", "created_at"], {
    name: "idx_event_outbox_claimable",
    where: "status IN ('pending', 'failed', 'publishing')",
  });
  pgm.createIndex(
    "event_outbox",
    ["aggregate_type", "aggregate_id", "created_at"],
    {
      name: "idx_event_outbox_aggregate",
    },
  );
  pgm.createIndex("event_outbox", ["status", "created_at"], {
    name: "idx_event_outbox_status_created",
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropTable("event_outbox");
  pgm.dropType("outbox_event_status");
};
