exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE assignment_config
      ALTER COLUMN eligible_roles TYPE user_role[]
      USING eligible_roles::user_role[];
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE assignment_config
      ALTER COLUMN eligible_roles TYPE text[]
      USING eligible_roles::text[];
  `);
};
