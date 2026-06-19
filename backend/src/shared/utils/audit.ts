import { pool } from './db';
import { logger } from './logger';

export interface AuditLogEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

function toJsonValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/**
 * Writes a single row to `audit_logs`.
 *
 * Best-effort: any DB failure is logged but never rethrown, so audit logging
 * cannot break the business operation it is recording. Callers may still `await`
 * this to ensure the row is written before responding (TRD §10.6).
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.userId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        toJsonValue(entry.oldValue),
        toJsonValue(entry.newValue),
        entry.ipAddress ?? null,
      ],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.error('Failed to write audit log', {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      error: message,
    });
  }
}
