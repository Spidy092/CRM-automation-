import { pool, query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { Integration } from './integrations.types';

// Sensitive column — NEVER include in any SELECT that flows back to the client.
const SAFE_COLS = `id, name, display_name, is_enabled, last_tested_at, last_test_status, updated_by, updated_at`;

export async function findAll(): Promise<Integration[]> {
  // Server-internal use only (e.g. workers). Strips encrypted_credentials.
  return query<Integration>(`SELECT ${SAFE_COLS} FROM integrations ORDER BY display_name ASC`);
}

export async function findAllPublic(): Promise<Omit<Integration, 'encrypted_credentials'>[]> {
  return query<Omit<Integration, 'encrypted_credentials'>>(
    `SELECT ${SAFE_COLS} FROM integrations ORDER BY display_name ASC`,
  );
}

export async function findById(id: string): Promise<Integration | null> {
  return queryOne<Integration>(`SELECT ${SAFE_COLS} FROM integrations WHERE id = $1`, [id]);
}

export async function findByName(name: string): Promise<Integration | null> {
  return queryOne<Integration>(`SELECT ${SAFE_COLS} FROM integrations WHERE name = $1`, [name]);
}

/**
 * Reads credentials for a single integration. Used by connectors (workers)
 * that need the decrypted blob at dispatch time. NEVER expose via API.
 */
export async function findCredentialsById(id: string): Promise<string | null> {
  const row = await queryOne<{ encrypted_credentials: string | null }>(
    `SELECT encrypted_credentials FROM integrations WHERE id = $1`,
    [id],
  );
  return row?.encrypted_credentials ?? null;
}

export async function updateIntegration(
  id: string,
  fields: {
    isEnabled?: boolean;
    encryptedCredentials?: string | null;
    updatedBy: string;
  },
): Promise<Integration> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.isEnabled !== undefined) {
    sets.push(`is_enabled = $${i++}`);
    params.push(fields.isEnabled);
  }
  if (fields.encryptedCredentials !== undefined) {
    sets.push(`encrypted_credentials = $${i++}`);
    params.push(fields.encryptedCredentials);
  }
  sets.push(`updated_by = $${i++}`);
  params.push(fields.updatedBy);
  sets.push(`updated_at = NOW()`);

  params.push(id);

  const row = await queryOne<Integration>(
    `UPDATE integrations SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SAFE_COLS}`,
    params,
  );
  if (!row) throw new AppError('Integration not found', 404);
  return row;
}

export async function recordTestResult(
  id: string,
  status: 'ok' | 'failed' | 'no_credentials',
): Promise<Integration> {
  const row = await queryOne<Integration>(
    `UPDATE integrations
        SET last_tested_at = NOW(),
            last_test_status = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING ${SAFE_COLS}`,
    [status, id],
  );
  if (!row) throw new AppError('Integration not found', 404);
  return row;
}

export { pool };
