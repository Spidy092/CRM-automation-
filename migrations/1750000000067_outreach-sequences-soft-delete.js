/**
 * Adds deleted_at soft-delete column to outreach_sequences so that
 * deleting a sequence marks it rather than hard-deleting it, matching
 * the project convention (AGENTS.md: "All soft-deletes use deleted_at").
 */
exports.up = async (pgm) => {
  pgm.addColumn('outreach_sequences', {
    deleted_at: { type: 'timestamptz', notNull: false, default: null },
  });

  pgm.createIndex('outreach_sequences', 'deleted_at', {
    where: 'deleted_at IS NULL',
    name: 'idx_outreach_sequences_active',
  });
};

exports.down = async (pgm) => {
  pgm.dropIndex('outreach_sequences', 'deleted_at', {
    name: 'idx_outreach_sequences_active',
  });
  pgm.dropColumn('outreach_sequences', 'deleted_at');
};
