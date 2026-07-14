import { pool, query, queryOne, withTransaction } from '../../shared/utils/db';
import { LeadInput, LeadListFilters, LeadRow } from './leads.types';

const COLS = `id, business_name, contact_name, phone, email, website, industry, location,
  country, google_rating, review_count, social_links, source_platform, lead_score,
  classification, status, assigned_to, pipeline_stage_id, custom_fields, tags, notes,
  deal_value, created_at, updated_at, deleted_at`;

function jsonArray(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export async function findLeads(
  filters: LeadListFilters,
): Promise<{ rows: LeadRow[]; hasMore: boolean }> {
  const conditions: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  let i = 1;

  if (filters.status) {
    conditions.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.classification) {
    conditions.push(`classification = $${i++}`);
    params.push(filters.classification);
  }
  if (filters.source_platform) {
    conditions.push(`source_platform = $${i++}`);
    params.push(filters.source_platform);
  }
  if (filters.industry) {
    conditions.push(`industry = $${i++}`);
    params.push(filters.industry);
  }
  if (filters.country) {
    conditions.push(`country = $${i++}`);
    params.push(filters.country);
  }
  if (filters.assigned_to) {
    conditions.push(`assigned_to = $${i++}`);
    params.push(filters.assigned_to);
  }
  if (filters.pipeline_id) {
    conditions.push(
      `pipeline_stage_id IN (SELECT id FROM pipeline_stages WHERE pipeline_id = $${i++})`,
    );
    params.push(filters.pipeline_id);
  }
  if (filters.search) {
    conditions.push(
      `(business_name ILIKE $${i} OR contact_name ILIKE $${i} OR email ILIKE $${i} OR phone ILIKE $${i})`,
    );
    params.push(`%${filters.search}%`);
    i++;
  }
  if (filters.tags && filters.tags.length > 0) {
    conditions.push(`tags && $${i++}`); // array overlap
    params.push(filters.tags);
  }
  if (filters.cursorTs && filters.cursorId) {
    conditions.push(`(created_at, id) < ($${i}, $${i + 1})`);
    params.push(filters.cursorTs, filters.cursorId);
    i += 2;
  }

  // Fetch one extra row to determine hasMore without a separate COUNT.
  const fetchLimit = filters.limit + 1;
  conditions.push(`TRUE`); // keep join clean
  const sql = `SELECT ${COLS} FROM leads WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC, id DESC LIMIT $${i}`;
  params.push(fetchLimit);

  const rows = await query<LeadRow>(sql, params);
  const hasMore = rows.length > filters.limit;
  const trimmed = hasMore ? rows.slice(0, filters.limit) : rows;
  return { rows: trimmed, hasMore };
}

export async function findLeadById(id: string): Promise<LeadRow | null> {
  return queryOne<LeadRow>(`SELECT ${COLS} FROM leads WHERE id = $1 AND deleted_at IS NULL`, [id]);
}

/** Find an existing non-deleted lead in the same source matching email OR phone (dedup). */
export async function findExistingForDedup(
  email: string,
  phone: string,
  sourcePlatform: string,
): Promise<LeadRow | null> {
  return queryOne<LeadRow>(
    `SELECT ${COLS} FROM leads
     WHERE source_platform = $1
       AND deleted_at IS NULL
       AND (lower(email) = lower($2) OR phone = $3)
     LIMIT 1`,
    [sourcePlatform, email, phone],
  );
}

export async function insertLead(input: LeadInput): Promise<LeadRow> {
  const row = await queryOne<LeadRow>(
    `INSERT INTO leads (
       business_name, contact_name, phone, email, website, industry, location, country,
       google_rating, review_count, social_links, source_platform, lead_score, classification,
       status, assigned_to, pipeline_stage_id, custom_fields, tags, notes, deal_value
     ) VALUES (
       $1, $2, $3, lower($4), $5, $6, $7, $8,
       $9, $10, $11::jsonb, $12, 0, NULL,
       'active', $13, $14, $15::jsonb, COALESCE($16, '{}'::text[]), $17, $18
     )
     RETURNING ${COLS}`,
    [
      input.business_name,
      input.contact_name,
      input.phone,
      input.email,
      input.website ?? null,
      input.industry,
      input.location,
      input.country ?? null,
      input.google_rating ?? null,
      input.review_count ?? null,
      jsonArray(input.social_links),
      input.source_platform,
      input.assigned_to ?? null,
      input.pipeline_stage_id ?? null,
      jsonArray(input.custom_fields) ?? '{}',
      input.tags ?? null,
      input.notes ?? null,
      input.deal_value ?? null,
    ],
  );
  if (!row) throw new Error('Failed to insert lead');
  return row;
}

export async function updateLead(id: string, input: Partial<LeadInput>): Promise<LeadRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  // Scalar columns; email is lower-cased to match the dedup index.
  const scalars: [keyof LeadInput, string, boolean][] = [
    ['business_name', 'business_name', false],
    ['contact_name', 'contact_name', false],
    ['phone', 'phone', false],
    ['email', 'email', true], // lower-case
    ['website', 'website', false],
    ['industry', 'industry', false],
    ['location', 'location', false],
    ['country', 'country', false],
    ['google_rating', 'google_rating', false],
    ['review_count', 'review_count', false],
    ['source_platform', 'source_platform', false],
    ['assigned_to', 'assigned_to', false],
    ['pipeline_stage_id', 'pipeline_stage_id', false],
    ['notes', 'notes', false],
    ['deal_value', 'deal_value', false],
  ];

  for (const [key, col, lower] of scalars) {
    if (key in input && input[key] !== undefined) {
      const val = input[key] ?? null;
      sets.push(lower ? `${col} = lower($${i++})` : `${col} = $${i++}`);
      params.push(val);
    }
  }

  if (input.social_links !== undefined) {
    sets.push(`social_links = $${i++}::jsonb`);
    params.push(jsonArray(input.social_links));
  }
  if (input.custom_fields !== undefined) {
    sets.push(`custom_fields = $${i++}::jsonb`);
    params.push(jsonArray(input.custom_fields) ?? '{}');
  }
  if (input.tags !== undefined) {
    sets.push(`tags = $${i++}`);
    params.push(input.tags ?? []);
  }

  if (sets.length === 0) {
    // Nothing to update; return current row.
    const current = await findLeadById(id);
    if (!current) throw new Error('Lead not found or deleted');
    return current;
  }

  params.push(id);
  const row = await queryOne<LeadRow>(
    `UPDATE leads SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING ${COLS}`,
    params,
  );
  if (!row) throw new Error('Lead not found or deleted');
  return row;
}

export async function softDeleteLead(id: string): Promise<void> {
  await pool.query(`UPDATE leads SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [
    id,
  ]);
}

export async function updateLeadStatus(id: string, status: 'active' | 'paused'): Promise<LeadRow> {
  const row = await queryOne<LeadRow>(
    `UPDATE leads SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING ${COLS}`,
    [status, id],
  );
  if (!row) throw new Error('Lead not found or deleted');
  return row;
}

/** Transactional hook reserved for future cross-table lead operations. */
export async function runInTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(fn);
}

export interface LeadActivityEntry {
  id: string;
  kind: 'audit' | 'outreach';
  action: string | null;
  channel: string | null;
  status: string | null;
  actor_id: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

/** Returns merged audit_logs + outreach_logs for a lead, newest first. */
export async function findActivityForLead(
  leadId: string,
  limit: number,
): Promise<LeadActivityEntry[]> {
  const rows = await query<LeadActivityEntry>(
    `SELECT id, 'audit' AS kind, action, NULL AS channel, NULL AS status,
            user_id AS actor_id, old_value, new_value, created_at
       FROM audit_logs
      WHERE entity_type = 'lead' AND entity_id = $1
     UNION ALL
     SELECT id, 'outreach' AS kind, NULL AS action, channel::text, status::text,
            NULL AS actor_id, NULL AS old_value, NULL AS new_value, created_at
       FROM outreach_logs
      WHERE lead_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [leadId, limit],
  );
  return rows;
}
