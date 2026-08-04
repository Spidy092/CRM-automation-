import { pool, query, queryOne, withTransaction } from '../../shared/utils/db';
import { LeadStatus } from '../../shared/types';
import { LeadInput, LeadListFilters, LeadRow, LeadSortBy } from './leads.types';

/** Whitelist of sortable columns — the only place a column name reaches the SQL string. */
const SORT_COLUMNS: Record<LeadSortBy, string> = {
  created_at: 'created_at',
  updated_at: 'updated_at',
  business_name: 'business_name',
  contact_name: 'contact_name',
  email: 'email',
  industry: 'industry',
  location: 'location',
  lead_score: 'lead_score',
  deal_value: 'deal_value',
  status: 'status',
  classification: 'classification',
  next_follow_up_at: 'next_follow_up_at',
};

const COLS = `id, business_name, contact_name, phone, email, website, industry, location,
  country, google_rating, review_count, social_links, source_platform, lead_score,
  classification, status, assigned_to, pipeline_stage_id, custom_fields, tags, notes,
  deal_value, won_at, lost_at, next_follow_up_at, created_at, updated_at, deleted_at, scraper_log_id`;

function jsonArray(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/**
 * Shared WHERE builder for the list and count queries so both always see the
 * identical filter set. The keyset cursor is only applied when `includeCursor`
 * is true (the count must span every page, not just the ones after the cursor).
 */
function buildLeadFilterClauses(
  filters: LeadListFilters,
  includeCursor: boolean,
): { conditions: string[]; params: unknown[] } {
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
  if (filters.exclude_tags && filters.exclude_tags.length > 0) {
    conditions.push(`NOT (COALESCE(tags, '{}'::text[]) && $${i++})`);
    params.push(filters.exclude_tags);
  }
  if (filters.created_after) {
    conditions.push(`created_at >= $${i++}`);
    params.push(filters.created_after);
  }
  if (filters.unclassified) {
    conditions.push(`classification IS NULL`);
  }
  if (includeCursor && filters.cursorTs && filters.cursorId) {
    conditions.push(`(created_at, id) < ($${i}, $${i + 1})`);
    params.push(filters.cursorTs, filters.cursorId);
    i += 2;
  }

  return { conditions, params };
}

/** Keyset cursors are only valid for the default newest-first ordering. */
function usesKeysetCursor(filters: LeadListFilters): boolean {
  const sortBy = filters.sortBy ?? 'created_at';
  const sortDir = filters.sortDir ?? 'desc';
  return filters.offset === undefined && sortBy === 'created_at' && sortDir === 'desc';
}

export async function findLeads(
  filters: LeadListFilters,
): Promise<{ rows: LeadRow[]; hasMore: boolean }> {
  const keyset = usesKeysetCursor(filters);
  const { conditions, params } = buildLeadFilterClauses(filters, keyset);

  const sortColumn = SORT_COLUMNS[filters.sortBy ?? 'created_at'];
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
  // `id` is the tiebreaker so ordering is total and paging never repeats a row.
  const orderBy = `ORDER BY ${sortColumn} ${sortDir} NULLS LAST, id DESC`;

  // Fetch one extra row to determine hasMore without a separate COUNT.
  const fetchLimit = filters.limit + 1;
  let sql = `SELECT ${COLS} FROM leads WHERE ${conditions.join(' AND ')}
    ${orderBy} LIMIT $${params.length + 1}`;
  params.push(fetchLimit);

  if (!keyset && filters.offset) {
    sql += ` OFFSET $${params.length + 1}`;
    params.push(filters.offset);
  }

  const rows = await query<LeadRow>(sql, params);
  const hasMore = rows.length > filters.limit;
  const trimmed = hasMore ? rows.slice(0, filters.limit) : rows;
  return { rows: trimmed, hasMore };
}

/** Total number of non-deleted leads matching the same filters, ignoring paging. */
export async function countLeads(filters: LeadListFilters): Promise<number> {
  const { conditions, params } = buildLeadFilterClauses(filters, false);
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM leads WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return row ? Number(row.count) : 0;
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

/** All non-deleted leads created by a given scraper run, newest first. */
export async function findLeadsByScraperLogId(scraperLogId: string): Promise<LeadRow[]> {
  return query<LeadRow>(
    `SELECT ${COLS} FROM leads
     WHERE scraper_log_id = $1
       AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [scraperLogId],
  );
}

/** Non-deleted leads matching the given IDs — used to look up duplicate matches. */
export async function findLeadsByIds(ids: string[]): Promise<LeadRow[]> {
  if (ids.length === 0) return [];
  return query<LeadRow>(
    `SELECT ${COLS} FROM leads
     WHERE id = ANY($1::uuid[])
       AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [ids],
  );
}

export async function insertLead(input: LeadInput): Promise<LeadRow> {
  const row = await queryOne<LeadRow>(
    `INSERT INTO leads (
       business_name, contact_name, phone, email, website, industry, location, country,
       google_rating, review_count, social_links, source_platform, lead_score, classification,
       status, assigned_to, pipeline_stage_id, custom_fields, tags, notes, deal_value, scraper_log_id
     ) VALUES (
       $1, $2, $3, lower($4), $5, $6, $7, $8,
       $9, $10, $11::jsonb, $12, 0, NULL,
       'active', $13, $14, $15::jsonb, COALESCE($16, '{}'::text[]), $17, $18, $19
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
      input.scraper_log_id ?? null,
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
    ['next_follow_up_at', 'next_follow_up_at', false],
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

/**
 * Set the classification on up to 500 leads in a single UPDATE.
 * Returns the count of rows actually changed.
 */
export async function bulkClassifyLeads(
  ids: string[],
  classification: import('../../shared/types').LeadClassification,
): Promise<number> {
  if (ids.length === 0) return 0;
  // Build $1, $2, ... $N for the id list; classification is the last param.
  const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(', ');
  const classParam = `$${ids.length + 1}`;
  const result = await pool.query(
    `UPDATE leads
        SET classification = ${classParam}, updated_at = NOW()
      WHERE id IN (${placeholders})
        AND deleted_at IS NULL
        AND status NOT IN ('won', 'lost', 'opted_out')`,
    [...ids, classification],
  );
  return result.rowCount ?? 0;
}

export async function updateLeadStatus(id: string, status: 'active' | 'paused'): Promise<LeadRow> {
  const row = await queryOne<LeadRow>(
    `UPDATE leads SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING ${COLS}`,
    [status, id],
  );
  if (!row) throw new Error('Lead not found or deleted');
  return row;
}

/**
 * Applies the outcome of a pipeline stage move: 'won' and 'lost' stamp their
 * respective close timestamp (and clear the other); 'active' reopens the deal
 * and clears both. Used only when the destination/origin stage crosses a
 * terminal boundary — see resolveTerminalStatus() in pipeline.service.ts.
 */
export async function updateLeadOutcome(
  id: string,
  outcome: 'won' | 'lost' | 'active',
): Promise<LeadRow> {
  const row = await queryOne<LeadRow>(
    `UPDATE leads
     SET status = $1,
         won_at = CASE WHEN $1 = 'won' THEN NOW() ELSE NULL END,
         lost_at = CASE WHEN $1 = 'lost' THEN NOW() ELSE NULL END
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING ${COLS}`,
    [outcome, id],
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

export async function bulkUpdateLeads(
  ids: string[],
  input: Partial<LeadInput>,
): Promise<number> {
  if (ids.length === 0) return 0;

  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let i = 1;

  const scalars: [keyof LeadInput, string, boolean][] = [
    ['business_name', 'business_name', false],
    ['contact_name', 'contact_name', false],
    ['phone', 'phone', false],
    ['email', 'email', true],
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
    ['next_follow_up_at', 'next_follow_up_at', false],
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

  if (sets.length === 1) {
    return 0;
  }

  params.push(ids);
  const sql = `UPDATE leads SET ${sets.join(', ')} WHERE id = ANY($${i}::uuid[]) AND deleted_at IS NULL`;
  const res = await pool.query(sql, params);
  return res.rowCount ?? 0;
}

export async function bulkPauseLeads(
  ids: string[],
  status: LeadStatus,
): Promise<number> {
  if (ids.length === 0) return 0;
  const sourceStatusFilter = status === 'paused' ? "'active'" : "'paused'";
  const res = await pool.query(
    `UPDATE leads SET status = $1, updated_at = NOW() WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL AND status = ${sourceStatusFilter}`,
    [status, ids],
  );
  return res.rowCount ?? 0;
}
