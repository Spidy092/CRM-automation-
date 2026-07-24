// Fixes 1750000000056_landing-pages: that migration was already applied to this
// database with its original `content text` shape before the file was revised to
// the richer blocks/description model (Privyr-style content blocks: gallery, link,
// attachment, video, map). node-pg-migrate tracks applied migrations by filename,
// not content, so editing the already-run file did not update the live table —
// this migration brings it in line, forward-only, per the append-only migration rule.
exports.up = (pgm) => {
  pgm.addColumns('landing_pages', {
    description: {
      type: 'text',
    },
    blocks: {
      type: 'jsonb',
      notNull: true,
      default: '[]',
    },
  });
  pgm.dropColumn('landing_pages', 'content');
};

exports.down = (pgm) => {
  pgm.addColumns('landing_pages', {
    content: {
      type: 'text',
      notNull: true,
      default: '',
    },
  });
  pgm.dropColumns('landing_pages', ['description', 'blocks']);
};
