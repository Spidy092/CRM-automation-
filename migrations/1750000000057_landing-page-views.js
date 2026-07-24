exports.up = (pgm) => {
  pgm.createTable('landing_page_views', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    page_id: {
      type: 'uuid',
      notNull: true,
      references: '"landing_pages"',
      onDelete: 'CASCADE',
    },
    // Set when the public link was opened with ?lead=<id> (page shared with a specific lead).
    lead_id: {
      type: 'uuid',
      references: '"leads"',
      onDelete: 'SET NULL',
    },
    ip_address: {
      type: 'varchar(64)',
    },
    user_agent: {
      type: 'text',
    },
    viewed_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('landing_page_views', 'page_id');
  pgm.createIndex('landing_page_views', 'lead_id');
};

exports.down = (pgm) => {
  pgm.dropTable('landing_page_views');
};
