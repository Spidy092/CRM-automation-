/* eslint-disable camelcase */

/**
 * Migration: Seed — System User
 * Inserts the internal system user used as the owner of all default seed data.
 * This user is never used for login; it exists solely to satisfy FK constraints.
 *
 * ID: 00000000-0000-0000-0000-000000000001
 */

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (
      '${SYSTEM_USER_ID}',
      'System',
      'system@crm.internal',
      'not-a-real-hash',
      'admin'
    )
    ON CONFLICT (id) DO NOTHING
  `);
};

exports.down = (pgm) => {
  // Only safe to delete if no other data references this user.
  // In a fresh rollback (seeds rolled back in reverse order before schema),
  // dependent rows are removed first by earlier down() calls.
  pgm.sql(`
    DELETE FROM users WHERE id = '${SYSTEM_USER_ID}'
  `);
};
