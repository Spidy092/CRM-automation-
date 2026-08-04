export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'secret' | 'number' | 'list' | 'boolean';
  placeholder?: string;
  required?: boolean;
  helpText?: string;
}

export const CREDENTIAL_FIELDS: Record<string, FieldDef[]> = {
  whatsapp: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '12345678901234' },
    { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'EAAG...' },
    { key: 'apiVersion', label: 'API Version', placeholder: 'v20.0' },
    { key: 'appSecret', label: 'App Secret (for webhook verification)', type: 'password' },
  ],
  twilio: [
    { key: 'accountSid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxx' },
    { key: 'authToken', label: 'Auth Token', type: 'password' },
    { key: 'fromNumber', label: 'From Number (E.164)', placeholder: '+12025551234' },
  ],
  sendgrid: [
    { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'SG.xxxxx' },
    { key: 'fromEmail', label: 'From Email', placeholder: 'outreach@example.com' },
    { key: 'fromName', label: 'From Name', placeholder: 'My Company' },
  ],
  smtp: [
    { key: 'host', label: 'SMTP Host', placeholder: 'smtp.example.com' },
    { key: 'port', label: 'Port', type: 'number', placeholder: '587' },
    { key: 'user', label: 'Username' },
    { key: 'pass', label: 'Password', type: 'password' },
    { key: 'fromEmail', label: 'From Email', placeholder: 'outreach@example.com' },
    { key: 'fromName', label: 'From Name', placeholder: 'My Company' },
  ],
  google_ads: [
    { key: 'developerToken', label: 'Developer Token', type: 'password' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'password' },
    { key: 'loginCustomerId', label: 'MCC Customer ID (optional)', placeholder: '1234567890' },
  ],
  facebook: [
    { key: 'appId', label: 'App ID' },
    { key: 'appSecret', label: 'App Secret', type: 'password' },
    { key: 'accessToken', label: 'Access Token', type: 'password' },
    { key: 'pageId', label: 'Page ID (optional)' },
    { key: 'formId', label: 'Lead Form ID (optional)' },
  ],
  openwa: [
    { key: 'baseUrl', label: 'OpenWA Base URL', type: 'text', required: true, placeholder: 'https://openwa.example.com', helpText: 'The root URL of your external OpenWA HTTP server.' },
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true, helpText: 'OpenWA API key used in the x-api-key header.' },
    { key: 'sessionId', label: 'Session ID', type: 'text', required: true, helpText: 'WhatsApp session identifier managed by the OpenWA server.' },
    { key: 'numbers', label: 'Phone Numbers', type: 'list', required: true, helpText: 'One or more WhatsApp sender numbers for rotation (E.164 format).' },
  ],
  slack: [
    { key: 'webhookUrl', label: 'Slack Webhook URL', placeholder: 'https://hooks.slack.com/...' },
  ],
  teams: [
    { key: 'webhookUrl', label: 'Teams Webhook URL', placeholder: 'https://...webhook.office.com/...' },
  ],
  google_sheets: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'password' },
    { key: 'spreadsheetId', label: 'Spreadsheet ID (optional)' },
  ],
  google_calendar: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'password' },
    { key: 'calendarId', label: 'Calendar ID', placeholder: 'primary' },
  ],
  outlook: [
    { key: 'tenantId', label: 'Tenant ID' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'fromEmail', label: 'From Email' },
  ],
  hunter: [
    { key: 'api_key', label: 'Hunter.io API Key', type: 'password', required: true, helpText: 'Get your free API key at hunter.io' },
  ],
  apify: [
    { key: 'apiToken', label: 'API Token', type: 'password', required: true, helpText: 'Get your personal API token from Apify Settings -> Integrations.' },
  ],
  mailchimp: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us1', helpText: 'Found in Mailchimp → Account → Extras → API keys.' },
    { key: 'serverPrefix', label: 'Server Prefix', required: true, placeholder: 'us1', helpText: 'The part after the dash in your API key (e.g. us1, us6).' },
    { key: 'listId', label: 'Audience / List ID', helpText: 'The default audience to sync leads into. Found in Audience → Settings → Audience name and defaults.' },
  ],
  stripe: [
    { key: 'secretKey', label: 'Secret Key', type: 'password', required: true, placeholder: 'sk_live_...', helpText: 'From Stripe Dashboard → Developers → API keys. Use sk_test_... for testing.' },
    { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', helpText: 'Optional — from Stripe Dashboard → Webhooks → your endpoint → Signing secret.' },
  ],
  zapier: [
    { key: 'webhookUrl', label: 'Zapier Catch Hook URL', required: true, placeholder: 'https://hooks.zapier.com/hooks/catch/...', helpText: 'Create a Zap with "Webhooks by Zapier" trigger → Catch Hook, then paste the webhook URL here.' },
  ],
  linkedin: [
    { key: 'accessToken', label: 'Access Token', type: 'password', required: true, helpText: 'OAuth 2.0 access token from LinkedIn Developer portal → Auth tab.' },
    { key: 'organizationId', label: 'Organization ID', helpText: 'Your LinkedIn Company Page numeric ID (found in the page URL).' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456789:ABCdef...', helpText: 'Create a bot via @BotFather on Telegram. The token is shown after /newbot.' },
    { key: 'defaultChatId', label: 'Default Chat ID', helpText: 'Optional — the default chat/group ID to send messages to when no chatId is specified on a lead.' },
  ],
};

export const CATEGORY_MAP: Record<string, string> = {
  whatsapp: 'Messaging',
  twilio: 'Messaging',
  sendgrid: 'Messaging',
  smtp: 'Messaging',
  openwa: 'Messaging',
  telegram: 'Messaging',
  google_sheets: 'Productivity',
  google_calendar: 'Productivity',
  outlook: 'Productivity',
  zapier: 'Automation',
  google_ads: 'Advertising',
  facebook: 'Advertising',
  linkedin: 'Lead Generation',
  hunter: 'Data Enrichment',
  apify: 'Data Enrichment',
  mailchimp: 'Email Marketing',
  stripe: 'Payments',
  google_drive: 'Storage',
};

export const CATEGORY_ORDER = [
  'Messaging',
  'Email Marketing',
  'Lead Generation',
  'Advertising',
  'Automation',
  'Productivity',
  'Payments',
  'Data Enrichment',
  'Storage',
  'Other',
];

export const INTEGRATION_DESCRIPTIONS: Record<string, string> = {
  whatsapp: 'Send WhatsApp messages via the Cloud API',
  twilio: 'Send SMS and make calls via Twilio',
  sendgrid: 'Send transactional and marketing emails',
  smtp: 'Send emails via your own SMTP server',
  openwa: 'Self-hosted WhatsApp with anti-ban features',
  telegram: 'Send messages via Telegram Bot API',
  google_sheets: 'Export leads and reports to spreadsheets',
  google_calendar: 'Create follow-up meetings and reminders',
  outlook: 'Send emails via Microsoft 365 / Outlook',
  zapier: 'Trigger automations via webhook events',
  google_ads: 'Import leads from Google Ads lead forms',
  facebook: 'Import leads from Facebook Lead Ads',
  linkedin: 'Import leads from LinkedIn Lead Gen Forms',
  hunter: 'Enrich leads with email discovery',
  apify: 'Scrape web data using Apify actors',
  mailchimp: 'Sync contacts to Mailchimp audiences',
  stripe: 'Generate payment links for leads',
  google_drive: 'Store and manage files in Google Drive',
};

export function getCategory(name: string): string {
  return CATEGORY_MAP[name] ?? 'Other';
}

export function groupByCategory<T extends { name: string }>(items: T[]): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const category = getCategory(item.name);
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {});
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
