exports.up = (pgm) => {
  pgm.createTable('landing_pages', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    slug: {
      type: 'varchar(255)',
      notNull: true,
    },
    content: {
      type: 'text',
      notNull: true,
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'draft',
    },
    created_by: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    deleted_at: {
      type: 'timestamp with time zone',
    },
  });

  pgm.addConstraint('landing_pages', 'landing_pages_status_check', {
    check: "status IN ('draft', 'published')",
  });

  // Partial unique index so a soft-deleted page's slug can be reused.
  pgm.createIndex('landing_pages', 'slug', {
    unique: true,
    where: 'deleted_at IS NULL',
  });
  pgm.createIndex('landing_pages', 'created_by');
};

exports.down = (pgm) => {
  pgm.dropTable('landing_pages');
};
