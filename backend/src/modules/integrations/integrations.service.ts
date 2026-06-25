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
  try {
    JSON.parse(decrypt(credentials));
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
      case 'whatsapp':
        await whatsappConnector.loadCredentials();
        testMessage = 'WhatsApp credentials validated (shape + decryption OK).';
        break;
      case 'twilio':
        await twilioConnector.loadCredentials();
        testMessage = 'Twilio credentials validated (shape + decryption OK).';
        break;
      case 'sendgrid':
        await sendgridConnector.loadCredentials();
        testMessage = 'SendGrid credentials validated (shape + decryption OK).';
        break;
      case 'smtp':
        await smtpConnector.loadCredentials();
        testMessage = 'SMTP credentials validated (shape + decryption OK).';
        break;
      case 'google_sheets':
        await googleSheetsConnector.loadCredentials();
        testMessage = 'Google Sheets credentials validated (shape + decryption OK).';
        break;
      case 'google_calendar':
        await googleCalendarConnector.loadCredentials();
        testMessage = 'Google Calendar credentials validated (shape + decryption OK).';
        break;
      case 'outlook':
        await outlookConnector.loadCredentials();
        testMessage = 'Outlook credentials validated (shape + decryption OK).';
        break;
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
