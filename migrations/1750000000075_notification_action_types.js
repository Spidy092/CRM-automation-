/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addTypeValue('notification_type', 'reply_received');
  pgm.addTypeValue('notification_type', 'approval_required');
  pgm.addTypeValue('notification_type', 'follow_up_due');
  pgm.addTypeValue('notification_type', 'automation_failed');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {
  // PostgreSQL enum values cannot be safely removed without rebuilding the type.
};
