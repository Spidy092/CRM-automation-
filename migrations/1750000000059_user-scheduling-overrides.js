/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  await pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_date_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      override_date VARCHAR(10) NOT NULL,
      is_blocked BOOLEAN NOT NULL DEFAULT true,
      start_time VARCHAR(5),
      end_time VARCHAR(5),
      reason VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_date_overrides_unique
      ON user_date_overrides(user_id, override_date);
  `);
};

exports.down = async (pgm) => {
  await pgm.sql(`DROP TABLE IF EXISTS user_date_overrides CASCADE`);
};
