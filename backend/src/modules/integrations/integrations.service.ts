import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { decrypt, encryptJson } from '../../shared/utils/encryption';
import {
  findAllPublic,
  findById,
  findCredentialsById,
  recordTestResult,
  updateIntegration as updateIntegrationRepo,
} from './integrations.repository';
import {
  Integration,
  IntegrationActor,
  IntegrationBulkTestResult,
  IntegrationPublic,
  IntegrationTestResult,
  IntegrationUpdateInput,
} from './integrations.types';
import * as whatsappConnector from './whatsapp/whatsapp.connector';
import * as twilioConnector from './twilio/twilio.connector';
import * as sendgridConnector from './sendgrid/sendgrid.connector';
import * as smtpConnector from './smtp/smtp.connector';
import * as googleSheetsConnector from './google-sheets/google-sheets.connector';
import * as googleCalendarConnector from './google-calendar/google-calendar.connector';
import * as outlookConnector from './outlook/outlook.connector';
import * as openwaConnector from './openwa/openwa.connector';
import * as hunterConnector from './hunter/hunter.service';
import * as mailchimpConnector from './mailchimp/mailchimp.connector';
import * as stripeConnector from './stripe/stripe.connector';
import * as zapierConnector from './zapier/zapier.connector';
import * as linkedinConnector from './linkedin/linkedin.connector';
import * as telegramConnector from './telegram/telegram.connector';
import * as apifyConnector from './apify/apify.connector';

function toPublic(row: Integration | IntegrationPublic): IntegrationPublic {
  // Explicit field projection — keeps `encrypted_credentials` out of the response.
  return {
    id: row.id,
    name: row.name,
    display_name: row.display_name,
    is_enabled: row.is_enabled,
    last_tested_at: row.last_tested_at,
    last_test_status: row.last_test_status,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

export async function listIntegrations(): Promise<IntegrationPublic[]> {
  const rows = await findAllPublic();
  return rows.map((r) => toPublic(r));
}

/**
 * Tests all enabled integrations in parallel.
 * Disabled integrations are counted as skipped and are not exercised.
 * Each individual test is wrapped so one failure cannot abort the batch.
 */
export async function testAllIntegrations(
  actor: IntegrationActor,
): Promise<IntegrationBulkTestResult> {
  const integrations = await findAllPublic();

  const enabled = integrations.filter((i) => i.is_enabled);
  const skipped = integrations.length - enabled.length;

  const settled = await Promise.allSettled(
    enabled.map(async (integration) => {
      try {
        const result = await testIntegration(integration.id, actor);
        return {
          id: integration.id,
          name: integration.name,
          ok: result.ok,
          status: result.status,
          message: result.message,
          tested_at: result.tested_at,
        };
      } catch (err) {
        // Defensive fallback: testIntegration normally never throws, but if it
        // does we still want the batch to continue and report the reason.
        const message = err instanceof Error ? err.message : 'unknown error';
        return {
          id: integration.id,
          name: integration.name,
          ok: false,
          status: 'failed',
          message,
          tested_at: new Date().toISOString(),
        };
      }
    }),
  );

  const results = settled.map((outcome) => {
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    // Promise.allSettled rejects only when the inner wrapper itself throws,
    // which should never happen. Provide a safe fallback just in case.
    return {
      id: 'unknown',
      name: 'unknown',
      ok: false,
      status: 'failed',
      message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      tested_at: new Date().toISOString(),
    };
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  return {
    total: integrations.length,
    passed,
    failed,
    skipped,
    results,
  };
}

export async function getIntegration(id: string): Promise<IntegrationPublic> {
  const row = await findById(id);
  if (!row) throw new AppError('Integration not found', 404);
  return toPublic(row);
}

export async function updateIntegration(
  id: string,
  input: IntegrationUpdateInput,
  actor: IntegrationActor,
): Promise<IntegrationPublic> {
  const before = await findById(id);
  if (!before) throw new AppError('Integration not found', 404);

  // Whitelist audit fields — NEVER include the encrypted blob or any secret.
  const beforePublic = toPublic(before);

  let encryptedCredentials: string | null | undefined;
  if (input.credentials !== undefined) {
    encryptedCredentials = input.credentials === null ? null : encryptJson(input.credentials);
  }

  const updated = await updateIntegrationRepo(id, {
    isEnabled: input.is_enabled,
    encryptedCredentials,
    updatedBy: actor.id,
  });
  const updatedPublic = toPublic(updated);

  await writeAuditLog({
    userId: actor.id,
    action: 'integration.updated',
    entityType: 'integration',
    entityId: id,
    oldValue: { ...beforePublic, credentials_changed: encryptedCredentials !== undefined },
    newValue: { ...updatedPublic, credentials_changed: encryptedCredentials !== undefined },
    ipAddress: actor.ipAddress ?? null,
  });

  return updatedPublic;
}

/**
 * Tests the integration — decrypts credentials, validates schema via the
 * connector's loadCredentials(), and (where supported) performs a live
 * vendor handshake.
 *
 * NEVER returns decrypted credentials. NEVER logs them.
 */
export async function testIntegration(
  id: string,
  actor: IntegrationActor,
): Promise<IntegrationTestResult> {
  const integration = await findById(id);
  if (!integration) throw new AppError('Integration not found', 404);

  let credentials: string | null = null;
  try {
    credentials = await findCredentialsById(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await recordTestResult(id, 'failed');
    return {
      ok: false,
      status: 'failed',
      message: `Failed to read credentials: ${message}`,
      tested_at: new Date().toISOString(),
    };
  }

  if (!credentials) {
    await recordTestResult(id, 'no_credentials');
    return {
      ok: false,
      status: 'no_credentials',
      message: 'No credentials configured for this integration',
      tested_at: new Date().toISOString(),
    };
  }

  // Base sanity-check: credentials must decrypt to valid JSON.
  let decryptedCredentials: Record<string, unknown> | null = null;
  try {
    decryptedCredentials = JSON.parse(decrypt(credentials)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await recordTestResult(id, 'failed');
    await writeAuditLog({
      userId: actor.id,
      action: 'integration.test_failed',
      entityType: 'integration',
      entityId: id,
      newValue: { reason: 'decryption_failed', error: message },
      ipAddress: actor.ipAddress ?? null,
    });
    return {
      ok: false,
      status: 'failed',
      message: `Credential decryption failed: ${message}`,
      tested_at: new Date().toISOString(),
    };
  }

  // Per-connector credential shape validation (and live ping where possible).
  let testMessage = 'Credentials validated successfully.';
  try {
    switch (integration.name) {
      case 'whatsapp': {
        const creds = await whatsappConnector.loadCredentials();
        const testRes = await whatsappConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `WhatsApp connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'twilio': {
        const creds = await twilioConnector.loadCredentials();
        const testRes = await twilioConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Twilio connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'sendgrid': {
        const creds = await sendgridConnector.loadCredentials();
        const testRes = await sendgridConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `SendGrid connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'smtp': {
        const creds = await smtpConnector.loadCredentials();
        const testRes = await smtpConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `SMTP connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'google_sheets': {
        const creds = await googleSheetsConnector.loadCredentials();
        const testRes = await googleSheetsConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Google Sheets connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'google_calendar': {
        const creds = await googleCalendarConnector.loadCredentials();
        const testRes = await googleCalendarConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Google Calendar connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'outlook': {
        const creds = await outlookConnector.loadCredentials();
        const testRes = await outlookConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Outlook connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'openwa': {
        const loaded = await openwaConnector.loadCredentials(decryptedCredentials);
        const healthCheck = await openwaConnector.healthCheck({ credentials: loaded });
        if (healthCheck.ok) {
          testMessage = `OpenWA session healthy (${healthCheck.latencyMs}ms).`;
        } else {
          const errorMessage = healthCheck.error ?? 'OpenWA health check failed';
          await recordTestResult(id, 'failed');
          await writeAuditLog({
            userId: actor.id,
            action: 'integration.test_failed',
            entityType: 'integration',
            entityId: id,
            newValue: { reason: 'openwa_health_check_failed', error: errorMessage },
            ipAddress: actor.ipAddress ?? null,
          });
          return {
            ok: false,
            status: 'failed',
            message: errorMessage,
            tested_at: new Date().toISOString(),
          };
        }
        break;
      }
      case 'hunter': {
        const creds = await hunterConnector.loadCredentials(decryptedCredentials || undefined);
        const testRes = await hunterConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Hunter.io connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'mailchimp': {
        const creds = await mailchimpConnector.loadCredentials();
        const testRes = await mailchimpConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Mailchimp connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'stripe': {
        const creds = await stripeConnector.loadCredentials();
        const testRes = await stripeConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Stripe connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'zapier': {
        const creds = await zapierConnector.loadCredentials();
        const testRes = await zapierConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Zapier webhook reachable (${testRes.latencyMs}ms).`;
        break;
      }
      case 'linkedin': {
        const creds = await linkedinConnector.loadCredentials();
        const testRes = await linkedinConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `LinkedIn connection successful (${testRes.latencyMs}ms).`;
        break;
      }
      case 'telegram': {
        const creds = await telegramConnector.loadCredentials();
        const testRes = await telegramConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Telegram bot connected${testRes.botUsername ? ` (@${testRes.botUsername})` : ''} (${testRes.latencyMs}ms).`;
        break;
      }
      case 'apify': {
        const creds = await apifyConnector.loadCredentials();
        const testRes = await apifyConnector.testConnection(creds);
        if (!testRes.ok) throw new Error(`Live test failed: ${testRes.error}`);
        testMessage = `Apify connected${testRes.username ? ` (${testRes.username})` : ''} (${testRes.latencyMs}ms).`;
        break;
      }
      default:
        testMessage = `Credentials for "${integration.display_name}" decrypted and parsed successfully.`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await recordTestResult(id, 'failed');
    await writeAuditLog({
      userId: actor.id,
      action: 'integration.test_failed',
      entityType: 'integration',
      entityId: id,
      newValue: { reason: 'connector_validation_failed', error: message },
      ipAddress: actor.ipAddress ?? null,
    });
    return {
      ok: false,
      status: 'failed',
      message: `Connector credential validation failed: ${message}`,
      tested_at: new Date().toISOString(),
    };
  }

  await recordTestResult(id, 'ok');
  await writeAuditLog({
    userId: actor.id,
    action: 'integration.tested',
    entityType: 'integration',
    entityId: id,
    ipAddress: actor.ipAddress ?? null,
  });

  return {
    ok: true,
    status: 'ok',
    message: testMessage,
    tested_at: new Date().toISOString(),
  };
}
