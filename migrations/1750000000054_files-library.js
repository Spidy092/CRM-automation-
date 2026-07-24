exports.up = (pgm) => {
  pgm.createTable('files', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    filename: {
      type: 'varchar(255)',
      notNull: true,
    },
    mime_type: {
      type: 'varchar(100)',
      notNull: true,
    },
    size_bytes: {
      type: 'integer',
      notNull: true,
    },
    storage_path: {
      type: 'text',
      notNull: true,
    },
    url: {
      type: 'text',
      notNull: true,
    },
    tags: {
      type: 'text[]',
      notNull: true,
      default: '{}',
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

  pgm.createIndex('files', 'created_by');
};

exports.down = (pgm) => {
  pgm.dropTable('files');
};
