type UnknownRecord = Record<string, unknown>;

const NAME_KEYS = ['business_name', 'name', 'title', 'goal', 'email', 'id'] as const;
const MAX_LISTED_NAMES = 5;
const MAX_SCALAR_LINES = 10;
const FALLBACK_JSON_LIMIT = 600;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function displayName(item: unknown): string {
  if (!isRecord(item)) return 'unnamed';
  for (const key of NAME_KEYS) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'unnamed';
}

function summarizeList(items: unknown[], hasMore: boolean): string {
  if (items.length === 0) return 'No matching records found.';
  const names = items.slice(0, MAX_LISTED_NAMES).map(displayName).join(', ');
  const count = `${items.length}${hasMore ? '+' : ''}`;
  const suffix = hasMore ? ' Say "more" to see the next page.' : '';
  return `Found ${count} record(s): ${names}${items.length > MAX_LISTED_NAMES ? ', …' : ''}.${suffix}`;
}

function summarizeObject(record: UnknownRecord): string | null {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (lines.length >= MAX_SCALAR_LINES) break;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      lines.push(`${key}: ${String(value)}`);
    } else if (Array.isArray(value)) {
      lines.push(`${key}: ${value.length} entries`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Turn a raw read-action result into a short, human-readable chat reply
 * instead of a JSON dump.
 */
export function summarizeReadResult(raw: unknown): string {
  let value = raw;
  // proposeAgentAction wraps successful results as { value: ... }
  if (isRecord(value) && 'value' in value && Object.keys(value).length === 1) {
    value = value.value;
  }

  if (Array.isArray(value)) return summarizeList(value, false);

  if (isRecord(value)) {
    const items = value.items;
    if (Array.isArray(items)) {
      const meta = isRecord(value.meta) ? value.meta : {};
      return summarizeList(items, meta.hasMore === true);
    }
    const summary = summarizeObject(value);
    if (summary) return summary;
  }

  if (value === undefined || value === null) return 'No data returned.';
  return JSON.stringify(value).slice(0, FALLBACK_JSON_LIMIT);
}
