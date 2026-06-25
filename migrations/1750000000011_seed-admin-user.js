/* eslint-disable camelcase */

/**
 * Migration: Seed — Default Admin User
 *
 * Creates the initial admin account for first login.
 *   Email:    admin@crm.io
 *   Password: Admin@1234
 *
 * IMPORTANT: Change the password immediately after first login.
 */

const ADMIN_USER_ID = '00000000-0000-0000-0000-000000000002';

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO users (id, name, email, password_hash, role, is_active)
    VALUES (
      '${ADMIN_USER_ID}',
      'Admin',
      'admin@crm.io',
      '$2b$12$HHZjckHIz5RuEHGgzZ.DW.YbXE2Bvie8NJq8oiBG3V4sTwdAvSrUq',
      'admin',
      TRUE
    )
    ON CONFLICT (email) DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM users WHERE id = '${ADMIN_USER_ID}'`);
};
