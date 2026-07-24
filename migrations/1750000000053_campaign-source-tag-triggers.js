exports.up = (pgm) => {
  pgm.addColumn('campaigns', {
    trigger_source: {
      type: 'text[]',
      comment:
        'Lead source_platform values that auto-enroll a new lead into this campaign. Null/empty = not a condition.',
    },
    trigger_tags: {
      type: 'text[]',
      comment:
        'Lead tags that auto-enroll a new lead into this campaign (any-match). Null/empty = not a condition.',
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('campaigns', ['trigger_source', 'trigger_tags']);
};
