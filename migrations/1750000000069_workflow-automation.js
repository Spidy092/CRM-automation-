/**
 * Migration 0069: workflow definitions and immutable versions.
 *
 * Runtime enrollments and step execution records are intentionally deferred to
 * the worker phase. This migration only persists drafts and published graphs.
 */

exports.up = (pgm) => {
  pgm.createType("workflow_status", [
    "draft",
    "published",
    "paused",
    "archived",
  ]);
  pgm.createType("workflow_version_status", ["draft", "published", "retired"]);

  pgm.createTable("workflows", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "varchar(255)", notNull: true },
    description: { type: "text" },
    status: { type: "workflow_status", notNull: true, default: "draft" },
    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
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
    deleted_at: { type: "timestamptz" },
  });
  pgm.createIndex("workflows", "status", { name: "idx_workflows_status" });
  pgm.createIndex("workflows", "created_by", {
    name: "idx_workflows_created_by",
  });
  pgm.createIndex("workflows", "updated_at", {
    name: "idx_workflows_updated_at",
  });

  pgm.createTable(
    "workflow_versions",
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
        onDelete: "CASCADE",
      },
      version: { type: "integer", notNull: true },
      definition: { type: "jsonb", notNull: true },
      status: {
        type: "workflow_version_status",
        notNull: true,
        default: "draft",
      },
      created_by: {
        type: "uuid",
        notNull: true,
        references: "users",
        onDelete: "RESTRICT",
      },
      published_at: { type: "timestamptz" },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("NOW()"),
      },
    },
    {
      constraints: {
        workflow_version_unique: "UNIQUE (workflow_id, version)",
        workflow_version_positive: "CHECK (version > 0)",
      },
    },
  );
  pgm.createIndex("workflow_versions", ["workflow_id", "version"], {
    name: "idx_workflow_versions_workflow_version",
  });
  pgm.createIndex("workflow_versions", ["workflow_id", "status"], {
    name: "idx_workflow_versions_workflow_status",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("workflow_versions");
  pgm.dropTable("workflows");
  pgm.dropType("workflow_version_status");
  pgm.dropType("workflow_status");
};
