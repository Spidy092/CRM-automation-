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
 * Tests the integration. For S3-01 this validates that stored credentials
 * decrypt cleanly and have the expected shape. Once connectors land in
 * S3-07/08/09, this will dispatch to `connectors/<name>.test(integration)`.
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
    // DB failure — record and surface.
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

  // Decrypt-then-validate. We only check parseability here — vendor-specific
  // shape validation belongs in the connector (S3-07/08/09).
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
    message: 'Credentials decrypt successfully. Vendor handshake will be added in S3-07/08/09.',
    tested_at: new Date().toISOString(),
  };
}
