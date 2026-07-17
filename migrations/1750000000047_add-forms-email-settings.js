/**
 * Migration 0045: Add email_settings to forms.
 *
 * Adds a new JSONB column to the forms table to store configuration
 * for three types of automated emails triggered on form submission:
 * auto-reply to lead, team notification, and partner notification.
 */

exports.up = (pgm) => {
  pgm.addColumn('forms', {
    email_settings: { type: 'jsonb', notNull: true, default: '{}' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('forms', 'email_settings');
};
