/* eslint-disable camelcase */

/**
 * Migration: Seed — Integration Registry
 * Registers all 10 supported third-party integrations in a disabled state.
 * Credentials are configured by an admin via the UI after deployment.
 */

const INTEGRATIONS = [
  { name: 'whatsapp',        display_name: 'WhatsApp Cloud API' },
  { name: 'twilio',          display_name: 'Twilio SMS' },
  { name: 'sendgrid',        display_name: 'SendGrid Email' },
  { name: 'smtp',            display_name: 'SMTP Server' },
  { name: 'google_sheets',   display_name: 'Google Sheets' },
  { name: 'google_calendar', display_name: 'Google Calendar' },
  { name: 'outlook',         display_name: 'Microsoft Outlook' },
  { name: 'slack',           display_name: 'Slack' },
  { name: 'teams',           display_name: 'Microsoft Teams' },
  { name: 'crm',             display_name: 'External CRM Platform' },
];

exports.up = (pgm) => {
  const values = INTEGRATIONS.map(
    (i) => `('${i.name}', '${i.display_name}', FALSE)`,
  ).join(',\n      ');

  pgm.sql(`
    INSERT INTO integrations (name, display_name, is_enabled)
    VALUES
      ${values}
    ON CONFLICT (name) DO NOTHING
  `);
};

exports.down = (pgm) => {
  const names = INTEGRATIONS.map((i) => `'${i.name}'`).join(', ');
  pgm.sql(`DELETE FROM integrations WHERE name IN (${names})`);
};
