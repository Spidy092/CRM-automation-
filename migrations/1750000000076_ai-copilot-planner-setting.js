/** Saved admin preference; null preserves the deployment flag until first save. */
exports.up = function (pgm) {
  pgm.addColumns('ai_settings', {
    planner_enabled: { type: 'boolean', notNull: false, default: null },
  });
};

exports.down = function (pgm) {
  pgm.dropColumns('ai_settings', ['planner_enabled']);
};
