exports.up = (pgm) => {
  pgm.createTable('message_snippets', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    channel: {
      type: 'message_channel',
    },
    body: {
      type: 'text',
      notNull: true,
    },
    variables: {
      type: 'text[]',
      notNull: true,
      default: '{}',
    },
    file_ids: {
      type: 'uuid[]',
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

  pgm.createIndex('message_snippets', 'created_by');
};

exports.down = (pgm) => {
  pgm.dropTable('message_snippets');
};
