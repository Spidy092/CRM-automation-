/**
 * Migration 0085: correct campaign-operations execution defaults and persist dispatch mode.
 *
 * Corrects migration 0084 without editing it (append-only rule):
 *  - 0084 declared string defaults with embedded quotes (`default: "'active'"`),
 *    which compile to DEFAULT $pga$'active'$pga$ — a seven-character value
 *    including the apostrophes. That value violates the enrollment CHECK
 *    constraint on any row populated by the default. This migration resets
 *    both defaults to plain strings and backfills any rows that already
 *    received the quoted values.
 *  - Persists the immutable dispatch mode (`mock_mode`) per step execution
 *    and per enrollment so recovery, resume, and retry republish simulated
 *    work as simulated — never silently converting it into real outreach.
 *    Pre-existing rows default to false (real dispatch), matching the legacy
 *    transport path, which never sent mock campaigns.
 *
 * REVIEW REQUIRED BEFORE RUNNING. Never edit this file after it has run;
 * add a new migration instead. Requires 0084 to have run first.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.alterColumn('campaign_leads', 'enrollment_status', { default: 'active' });
  pgm.alterColumn('campaign_step_executions', 'state', { default: 'unscheduled' });

  // Backfill rows populated by the quoted defaults, in case 0084 ran anywhere.
  pgm.sql(`UPDATE campaign_leads SET enrollment_status = 'active' WHERE enrollment_status = '''active'''`);
  pgm.sql(`UPDATE campaign_step_executions SET state = 'unscheduled' WHERE state = '''unscheduled'''`);

  pgm.addColumns('campaign_step_executions', {
    mock_mode: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addColumns('campaign_leads', {
    mock_mode: { type: 'boolean', notNull: true, default: false },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropColumns('campaign_leads', ['mock_mode']);
  pgm.dropColumns('campaign_step_executions', ['mock_mode']);
};
