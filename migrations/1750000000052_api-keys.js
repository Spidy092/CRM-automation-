exports.up = (pgm) => {
  pgm.createTable('api_keys', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    key_hash: {
      type: 'varchar(255)',
      notNull: true,
    },
    prefix: {
      type: 'varchar(32)',
      notNull: true,
    },
    last_used_at: {
      type: 'timestamp with time zone',
    },
    expires_at: {
      type: 'timestamp with time zone',
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
    }
  });

  pgm.createIndex('api_keys', 'user_id');
  pgm.createIndex('api_keys', 'key_hash');
};

exports.down = (pgm) => {
  pgm.dropTable('api_keys');
};
