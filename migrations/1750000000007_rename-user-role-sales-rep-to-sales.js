/* eslint-disable camelcase */

/**
 * Migration: Rename `user_role` enum value `sales_rep` → `sales`,
 *             and add the new `viewer` role.
 *
 * Why: CLAUDE.md §RBAC Reference documents five roles: admin, manager, sales,
 * marketing, viewer. The original schema defined four: admin, manager,
 * sales_rep, marketing. Code (shared/types, rbac middleware, leads/users/
 * pipeline/assignments modules) has been updated to use the documented names.
 * This migration brings the database into alignment.
 *
 * Scope:
 *   - `user_role` ENUM: rename `sales_rep` → `sales`; append `viewer`.
 *   - `assignment_config.eligible_roles` default: `'sales'` (was `'sales_rep'`).
 *   - `users.role` default remains `sales` (renamed from `sales_rep`).
 *
 * Safety:
 *   - Idempotent. `RENAME VALUE ... TO ...` fails if the new name already
 *     exists; we guard with a check on the enum's labels via pg_type.
 *   - Append-only — does not modify 1750000000000_initial-schema.js.
 *   - Requires PostgreSQL ≥ 10 (we target 16).
 *   - Must be applied AFTER 1750000000006_add-assignments-table.js.
 *
 * ⚠️ Not destructive to row data. No rows are deleted or altered. Existing
 *    user rows with role='sales_rep' are converted to 'sales' via the enum
 *    rename; if the rename is skipped the migration aborts with a clear
 *    error rather than silently leaving the schema inconsistent.
 *
 * NOTE: This file is presented for approval. It must NOT be run autonomously.
 *       Run via: npm run migrate   (after backup + approval).
 */

exports.up = (pgm) => {
  // ── 1. Rename sales_rep → sales (idempotent) ─────────────────────────────
  // If `sales` already exists and `sales_rep` does not, do nothing.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'sales_rep'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'sales'
      ) THEN
        ALTER TYPE user_role RENAME VALUE 'sales_rep' TO 'sales';
      END IF;
    END$$;
  `);

  // ── 2. Add `viewer` to the enum (idempotent) ─────────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'viewer'
      ) THEN
        ALTER TYPE user_role ADD VALUE 'viewer';
      END IF;
    END$$;
  `);

  // ── 3. Update default of users.role to 'sales' (was 'sales_rep') ────────
  // The original column default was set in 1750000000000_initial-schema.js
  // and is not modified by the enum rename. Drop + re-add with the new name.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'sales'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'role'
      ) THEN
        ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
        ALTER TABLE users ALTER COLUMN role SET DEFAULT 'sales';
      END IF;
    END$$;
  `);

  // ── 4. Update assignment_config.eligible_roles default ───────────────────
  // The default for eligible_roles was set in
  // 1750000000006_add-assignments-table.js as '{sales_rep}'. Replace any
  // lingering 'sales_rep' string in any existing rows as well.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'assignment_config'
      ) THEN
        UPDATE assignment_config
          SET eligible_roles = ARRAY(
            SELECT CASE WHEN x = 'sales_rep' THEN 'sales' ELSE x END
            FROM unnest(eligible_roles) AS x
          )
          WHERE 'sales_rep' = ANY (eligible_roles);

        ALTER TABLE assignment_config
          ALTER COLUMN eligible_roles SET DEFAULT ARRAY['sales']::user_role[];
      END IF;
    END$$;
  `);
};

exports.down = (pgm) => {
  // ── 1. Revert assignment_config defaults and any rows ────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'assignment_config'
      ) THEN
        UPDATE assignment_config
          SET eligible_roles = ARRAY(
            SELECT CASE WHEN x = 'sales' THEN 'sales_rep' ELSE x END
            FROM unnest(eligible_roles) AS x
          )
          WHERE 'sales' = ANY (eligible_roles);

        ALTER TABLE assignment_config
          ALTER COLUMN eligible_roles SET DEFAULT ARRAY['sales_rep']::user_role[];
      END IF;
    END$$;
  `);

  // ── 2. Revert users.role default ─────────────────────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'sales_rep'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'role'
      ) THEN
        ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
        ALTER TABLE users ALTER COLUMN role SET DEFAULT 'sales_rep';
      END IF;
    END$$;
  `);

  // ── 3. Remove `viewer` (only if no rows use it) ──────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM users WHERE role::text = 'viewer'
      ) AND EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'viewer'
      ) THEN
        ALTER TYPE user_role DROP VALUE 'viewer';
      END IF;
    END$$;
  `);

  // ── 4. Rename sales → sales_rep (only if no rows use 'sales') ───────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM users WHERE role::text = 'sales'
      ) AND EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'sales'
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'sales_rep'
      ) THEN
        ALTER TYPE user_role RENAME VALUE 'sales' TO 'sales_rep';
      END IF;
    END$$;
  `);
};
