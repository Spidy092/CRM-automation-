/* eslint-disable camelcase */

/**
 * Migration: Add soft-delete column to users table
 *
 * Why: Migration 005 (add-soft-delete-columns) added `deleted_at` to leads and
 * campaigns but omitted the users table. The users.repository.ts queries filter
 * on `WHERE deleted_at IS NULL`, which causes a "column does not exist" error
 * on every users endpoint (GET /api/v1/users, etc.).
 *
 * This migration adds the missing nullable `deleted_at timestamptz` column and a
 * supporting index so soft-deleted users are filtered efficiently.
 *
 * ⚠️ Not destructive:
 *   - Adds a single nullable column (existing rows get NULL, i.e. not deleted).
 *   - No row data is changed.
 *
 * Run via: npm run migrate   (after reviewing this file)
 */

exports.up = (pgm) => {
  // Add deleted_at to users (nullable — existing active users get NULL)
  pgm.addColumns('users', {
    deleted_at: { type: 'timestamptz' },
  });

  // Index to support `WHERE deleted_at IS NULL` filters
  pgm.sql(`CREATE INDEX idx_users_deleted_at ON users (deleted_at)`);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_users_deleted_at`);
  pgm.dropColumns('users', ['deleted_at']);
};
