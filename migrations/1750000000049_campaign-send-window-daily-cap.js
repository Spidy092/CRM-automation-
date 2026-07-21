/**
 * Migration: 1750000000049 — Campaign Send Window + Daily Send Cap
 *
 * Adds per-campaign delivery controls:
 *   - send_window_enabled: opt-in quiet-hours enforcement (default false)
 *   - send_window_start_hour / send_window_end_hour: local-time window,
 *     start inclusive, end exclusive (e.g. 9 → 18 means 09:00–17:59)
 *   - send_window_days: allowed ISO weekdays (1 = Monday … 7 = Sunday)
 *   - send_window_timezone: IANA timezone the window is evaluated in
 *   - daily_send_limit: max messages this campaign may send per local day
 *     (NULL = unlimited)
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumns('campaigns', {
    send_window_enabled: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    send_window_start_hour: {
      type: 'integer',
      notNull: true,
      default: 9,
    },
    send_window_end_hour: {
      type: 'integer',
      notNull: true,
      default: 18,
    },
    send_window_days: {
      type: 'integer[]',
      notNull: true,
      default: pgm.func("'{1,2,3,4,5}'"),
    },
    send_window_timezone: {
      type: 'varchar(64)',
      notNull: true,
      default: "'UTC'",
    },
    daily_send_limit: {
      type: 'integer',
      notNull: false,
    },
  });

  pgm.addConstraint(
    'campaigns',
    'campaigns_send_window_hours_check',
    'CHECK (send_window_start_hour >= 0 AND send_window_start_hour <= 23 AND send_window_end_hour >= 1 AND send_window_end_hour <= 24 AND send_window_start_hour < send_window_end_hour)',
  );
  pgm.addConstraint(
    'campaigns',
    'campaigns_daily_send_limit_check',
    'CHECK (daily_send_limit IS NULL OR daily_send_limit > 0)',
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropConstraint('campaigns', 'campaigns_send_window_hours_check');
  pgm.dropConstraint('campaigns', 'campaigns_daily_send_limit_check');
  pgm.dropColumns('campaigns', [
    'send_window_enabled',
    'send_window_start_hour',
    'send_window_end_hour',
    'send_window_days',
    'send_window_timezone',
    'daily_send_limit',
  ]);
};
