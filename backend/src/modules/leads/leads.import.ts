import { parse as parseCsv } from 'csv-parse/sync';
import { read as readXlsx, utils } from 'xlsx';
import { enqueueLeadEvent } from '../../workers/queue';
import { writeAuditLog } from '../../shared/utils/audit';
import { normalizePhone } from '../../shared/utils/phone';
import { findActiveDefinitions } from '../custom-fields/customFields.repository';
import { validateCustomFieldValues } from '../custom-fields/customFields.service';
import { findExistingForDedup, insertLead, updateLead } from './leads.repository';
import { createLeadSchema } from './leads.schema';
import { ImportSummary, LeadInput } from './leads.types';

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

export function isSupportedFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Parse an uploaded file buffer into an array of row objects (header-keyed). */
export function parseFile(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    return parseCsv(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as Record<string, unknown>[];
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const wb = readXlsx(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const sheet = wb.Sheets[sheetName];
    return utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  }
  throw new Error('Unsupported file type');
}

function normalizeHeader(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapRow(raw: Record<string, unknown>, defaultSource: string): LeadInput {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    norm[normalizeHeader(k)] = v;
  }

  const rowSource = toStr(norm.source_platform);
  const tagsRaw = toStr(norm.tags);

  const standardKeys = new Set([
    'business_name', 'contact_name', 'phone', 'email', 'website',
    'industry', 'location', 'country', 'google_rating', 'review_count',
    'source_platform', 'tags', 'notes'
  ]);

  const custom_fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(norm)) {
    if (!standardKeys.has(k) && v !== '') {
      custom_fields[k] = v;
    }
  }

  return {
    business_name: toStr(norm.business_name),
    contact_name: toStr(norm.contact_name),
    phone: toStr(norm.phone),
    email: toStr(norm.email),
    website: toStr(norm.website) || null,
    industry: toStr(norm.industry),
    location: toStr(norm.location),
    country: toStr(norm.country) || null,
    google_rating: toNumOrNull(norm.google_rating),
    review_count: toNumOrNull(norm.review_count),
    source_platform: rowSource || defaultSource,
    tags: tagsRaw
      ? tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    notes: toStr(norm.notes) || null,
    custom_fields,
  };
}

interface ImportActor {
  id: string;
  ipAddress?: string | null;
}

/**
 * Import leads from a parsed file buffer. Each row is validated and upserted
 * independently so one bad row does not abort the whole batch. Dedup is on
 * (email OR phone) + source_platform (TRD §8.3).
 */
export async function importLeads(
  buffer: Buffer,
  filename: string,
  defaultSource: string,
  actor: ImportActor,
): Promise<ImportSummary> {
  const rows = parseFile(buffer, filename);
  const summary: ImportSummary = {
    total: rows.length,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  const defs = await findActiveDefinitions();

  for (let idx = 0; idx < rows.length; idx++) {
    const rowNumber = idx + 2; // +1 for 0-index, +1 for header row
    try {
      const mapped = mapRow(rows[idx], defaultSource);
      const parsed = createLeadSchema.safeParse(mapped);
      if (!parsed.success) {
        summary.failed++;
        summary.errors.push({
          row: rowNumber,
          message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
        continue;
      }

      const input: LeadInput = {
        ...parsed.data,
        email: parsed.data.email.trim().toLowerCase(),
        phone: normalizePhone(parsed.data.phone),
      };

      const cfResult = validateCustomFieldValues(defs, input.custom_fields ?? null);
      if (!cfResult.valid) {
        summary.failed++;
        summary.errors.push({ row: rowNumber, message: cfResult.errors.join('; ') });
        continue;
      }
      input.custom_fields = cfResult.sanitized;

      const existing = await findExistingForDedup(input.email, input.phone, input.source_platform);
      if (existing) {
        const updated = await updateLead(existing.id, input);
        summary.updated++;
        await writeAuditLog({
          userId: actor.id,
          action: 'lead.updated',
          entityType: 'lead',
          entityId: updated.id,
          newValue: { source: 'import' },
          ipAddress: actor.ipAddress ?? null,
        });
      } else {
        const created = await insertLead(input);
        summary.created++;
        await writeAuditLog({
          userId: actor.id,
          action: 'lead.created',
          entityType: 'lead',
          entityId: created.id,
          newValue: { source: 'import' },
          ipAddress: actor.ipAddress ?? null,
        });
        void enqueueLeadEvent({ event: 'lead.created', leadId: created.id, payload: {} });
      }
    } catch (err) {
      summary.failed++;
      summary.errors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  return summary;
}
