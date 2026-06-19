/* eslint-disable camelcase */

/**
 * Migration: Add soft-delete columns
 *
 * Why: AGENTS.md mandates soft-deletes via `deleted_at` (never hard-delete lead
 * or campaign records). The initial schema (1750000000000) did not include these
 * columns, so this append-only migration adds them.
 *
 * It also converts the two lead dedup unique indexes into PARTIAL unique indexes
 * (WHERE deleted_at IS NULL) so that soft-deleted leads no longer occupy their
 * (email|phone, source_platform) slots and a re-imported lead can be re-created /
 * reactivated instead of hitting a unique-violation.
 *
 * ⚠️ Not destructive to row data:
 *   - Adds nullable columns (no backfill needed; existing rows get NULL deleted_at).
 *   - Drops + recreates only the two dedup UNIQUE INDEXES (no table/column drops).
 *
 * NOTE: This file is presented for approval. It must NOT be run autonomously.
 *       Run via: npm run migrate   (after backup + approval).
 */

exports.up = (pgm) => {
  // ── Add deleted_at columns ───────────────────────────────────────────────
  pgm.addColumns('leads', {
    deleted_at: { type: 'timestamptz' },
  });
  pgm.addColumns('campaigns', {
    deleted_at: { type: 'timestamptz' },
  });

  // ── Make lead dedup indexes partial (ignore soft-deleted rows) ───────────
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_dedup_email`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_dedup_phone`);
  pgm.sql(`
    CREATE UNIQUE INDEX idx_leads_dedup_email
      ON leads (lower(email), source_platform)
      WHERE deleted_at IS NULL
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX idx_leads_dedup_phone
      ON leads (phone, source_platform)
      WHERE deleted_at IS NULL
  `);

  // ── Indexes to support filtering out soft-deleted rows ───────────────────
  pgm.sql(`CREATE INDEX idx_leads_deleted_at ON leads (deleted_at)`);
  pgm.sql(`CREATE INDEX idx_campaigns_deleted_at ON campaigns (deleted_at)`);
};

exports.down = (pgm) => {
  // Restore original (non-partial) unique indexes
  pgm.sql(`DROP INDEX IF EXISTS idx_campaigns_deleted_at`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_deleted_at`);

  pgm.sql(`DROP INDEX IF EXISTS idx_leads_dedup_phone`);
  pgm.sql(`DROP INDEX IF EXISTS idx_leads_dedup_email`);
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_email ON leads (lower(email), source_platform)`);
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_phone ON leads (phone, source_platform)`);

  pgm.dropColumns('campaigns', ['deleted_at']);
  pgm.dropColumns('leads', ['deleted_at']);
};
