/**
 * Migration: 1750000000050 — Lead Won/Lost Timestamps
 *
 * Adds close-date tracking for deals:
 *   - won_at: set when a lead's pipeline stage moves into an is_terminal_won stage
 *   - lost_at: set when a lead's pipeline stage moves into an is_terminal_lost stage
 *
 * Both are cleared if the lead is later moved back into a non-terminal stage
 * (the deal is reopened) — see pipeline.service.ts / leads.service.ts.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumns('leads', {
    won_at: { type: 'timestamptz', notNull: false },
    lost_at: { type: 'timestamptz', notNull: false },
  });

  pgm.sql(`CREATE INDEX idx_leads_won_at ON leads (won_at) WHERE won_at IS NOT NULL`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropColumns('leads', ['won_at', 'lost_at']);
};
