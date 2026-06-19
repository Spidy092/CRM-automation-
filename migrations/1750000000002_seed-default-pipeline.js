/* eslint-disable camelcase */

/**
 * Migration: Seed — Default Pipeline & Stages
 * Creates the default 9-stage sales pipeline used by the platform out of the box.
 *
 * Pipeline ID:  00000000-0000-0000-0000-000000000010
 * Created by:   System user (00000000-0000-0000-0000-000000000001)
 */

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_PIPELINE_ID = '00000000-0000-0000-0000-000000000010';

exports.up = (pgm) => {
  // Insert default pipeline
  pgm.sql(`
    INSERT INTO pipelines (id, name, is_default, created_by)
    VALUES (
      '${DEFAULT_PIPELINE_ID}',
      'Default Sales Pipeline',
      TRUE,
      '${SYSTEM_USER_ID}'
    )
    ON CONFLICT (id) DO NOTHING
  `);

  // Insert default pipeline stages
  pgm.sql(`
    INSERT INTO pipeline_stages (pipeline_id, name, position, is_terminal_won, is_terminal_lost)
    VALUES
      ('${DEFAULT_PIPELINE_ID}', 'New Lead',           1, FALSE, FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Contacted',          2, FALSE, FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Follow-Up Required', 3, FALSE, FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Interested',         4, FALSE, FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Meeting Scheduled',  5, FALSE, FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Proposal Sent',      6, FALSE, FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Negotiation',        7, FALSE, FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Won',                8, TRUE,  FALSE),
      ('${DEFAULT_PIPELINE_ID}', 'Lost',               9, FALSE, TRUE)
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  // Stages cascade-delete when pipeline is deleted (ON DELETE CASCADE)
  pgm.sql(`
    DELETE FROM pipelines WHERE id = '${DEFAULT_PIPELINE_ID}'
  `);
};
