/**
 * Cursor-based pagination helpers.
 *
 * A cursor is a base64url-encoded JSON object `{ ts, id }` pointing to the last
 * row of the current page. The next page is fetched with:
 *   WHERE (created_at, id) < (cursor.ts, cursor.id) ORDER BY created_at DESC, id DESC
 *
 * Used for lead lists per TRD §4.1 (cursor-based for lead lists).
 */

export interface CursorPayload {
  ts: string; // ISO 8601 timestamp (created_at)
  id: string; // UUID
}

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

/** Encode a cursor payload into a base64url string. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Decode and validate a cursor string. Returns null if malformed. */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'ts' in parsed &&
      'id' in parsed &&
      typeof (parsed as CursorPayload).ts === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Clamp a user-supplied limit to the allowed range. */
export function clampLimit(raw: string | number | undefined): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.floor(n), MAX_PAGE_LIMIT);
}
