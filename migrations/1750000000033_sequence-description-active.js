/**
 * Migration 0033 — Add description and is_active to outreach_sequences
 *
 * description: free-text field for sequence purpose / notes
 * is_active:   soft-disable a sequence without deleting it (default true)
 */
exports.up = async (pgm) => {
  pgm.addColumn('outreach_sequences', {
    description: {
      type: 'text',
      notNull: false,
      default: null,
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumn('outreach_sequences', 'is_active');
  pgm.dropColumn('outreach_sequences', 'description');
};
