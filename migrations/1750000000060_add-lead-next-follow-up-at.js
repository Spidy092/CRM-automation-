/**
 * Migration: 1750000000060 — Lead Follow-up Reminder
 *
 * Adds a single lightweight reminder date per lead ("Quick Response"-adjacent
 * feature, mirrors Privyr's "No Follow Up Scheduled" picker on the lead
 * detail page): next_follow_up_at. Distinct from outreach.tasks (which model
 * assignable, sequence-linked work items) — this is just a rep's personal
 * "come back to this lead on X date" marker, set directly from the lead header.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumns('leads', {
    next_follow_up_at: { type: 'timestamptz', notNull: false },
  });

  pgm.sql(`CREATE INDEX idx_leads_next_follow_up_at ON leads (next_follow_up_at) WHERE next_follow_up_at IS NOT NULL`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropColumns('leads', ['next_follow_up_at']);
};
