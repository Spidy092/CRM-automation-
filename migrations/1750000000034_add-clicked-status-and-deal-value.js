/**
 * Migration 0034: Add 'clicked' outreach status, clicked_at column, and deal_value on leads.
 *
 * - Adds 'clicked' to the outreach_status ENUM type.
 * - Adds clicked_at timestamptz column to outreach_logs.
 * - Adds deal_value numeric(12,2) column to leads for basic revenue reporting.
 */

exports.up = async (pgm) => {
  // 1. Add 'clicked' to the outreach_status enum
  pgm.sql(`ALTER TYPE outreach_status ADD VALUE IF NOT EXISTS 'clicked' AFTER 'opened';`);

  // 2. Add clicked_at column to outreach_logs
  pgm.addColumn('outreach_logs', {
    clicked_at: { type: 'timestamptz', notNull: false, default: null },
  });

  // 3. Add deal_value column to leads
  pgm.addColumn('leads', {
    deal_value: { type: 'numeric(12,2)', notNull: false, default: null },
  });
};

exports.down = async (pgm) => {
  // PostgreSQL does not support removing values from an ENUM type.
  // Reverse the column additions only.
  pgm.dropColumn('leads', 'deal_value');
  pgm.dropColumn('outreach_logs', 'clicked_at');
};
