import { pool, query, queryOne } from '../../shared/utils/db';
import { encodeCursor } from '../../shared/utils/pagination';
import {
  Activity,
  ActivityListFilters,
  ActivityListResult,
  ActivityWithUser,
  CreateActivityInput,
} from './activities.types';

const ACTIVITY_COLS = 'id, lead_id, user_id, type, metadata, created_at';
const ACTIVITY_COLS_ALIASED = 'a.id, a.lead_id, a.user_id, a.type, a.metadata, a.created_at';

export async function insertActivity(
  input: CreateActivityInput,
  executor?: { query: typeof pool.query },
): Promise<Activity> {
  const db = executor ?? pool;
  const res = await db.query<Activity>(
    `INSERT INTO activities (lead_id, user_id, type, metadata)
     VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'::jsonb))
     RETURNING ${ACTIVITY_COLS}`,
    [
      input.lead_id,
      input.user_id,
      input.type,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  const row = res.rows[0] ?? null;
  if (!row) throw new Error('Failed to insert activity');
  return row;
}

export async function findFirstContactedAt(leadId: string): Promise<Date | null> {
  const row = await queryOne<{ first_contacted_at: Date | null }>(
    'SELECT first_contacted_at FROM leads WHERE id = $1 AND deleted_at IS NULL',
    [leadId],
  );
  return row?.first_contacted_at ?? null;
}

export async function createOutboundActivityAndUpdateLead(
  input: CreateActivityInput,
): Promise<Activity> {
  const activity = await insertActivity(input);
  await queryOne(
    `UPDATE leads
     SET first_contacted_at = NOW()
     WHERE id = $1 AND first_contacted_at IS NULL AND deleted_at IS NULL`,
    [input.lead_id],
  );
  return activity;
}

export async function findActivityById(id: string): Promise<Activity | null> {
  return queryOne<Activity>(`SELECT ${ACTIVITY_COLS} FROM activities WHERE id = $1`, [id]);
}

/**
 * Pins or unpins a note by flipping `metadata.pinned`. No columns are added:
 * the existing `metadata` JSONB carries the flag, so pinning needs no
 * migration and never rewrites or deletes the historical record — the pin
 * marker (`pinned`, `pinned_at`, `pinned_by`) is appended alongside the
 * original content. Unpinning sets `pinned: false` rather than deleting keys,
 * preserving the audit trail of what was pinned and when.
 */
export async function setActivityPinned(
  activityId: string,
  pinned: boolean,
  actorId: string,
): Promise<ActivityWithUser | null> {
  const patch = pinned
    ? `jsonb_build_object('pinned', true, 'pinned_at', NOW(), 'pinned_by', $2::text)`
    : `'{"pinned": false}'::jsonb`;
  return queryOne<ActivityWithUser>(
    `UPDATE activities AS a
        SET metadata = COALESCE(a.metadata, '{}'::jsonb) || ${patch}
      WHERE a.id = $1
      RETURNING a.id, a.lead_id, a.user_id, a.type, a.metadata, a.created_at,
        (SELECT name FROM users WHERE id = a.user_id) AS user_name,
        (SELECT email FROM users WHERE id = a.user_id) AS user_email,
        COALESCE(((COALESCE(a.metadata, '{}'::jsonb) || ${patch})->>'pinned')::boolean, false) AS is_pinned`,
    pinned ? [activityId, actorId] : [activityId],
  );
}

/**
 * Shared WHERE builder for the activities list and its count so both always
 * see the identical filter set. The keyset cursor is only applied when
 * `includeCursor` is true (the count must span every page).
 */
function buildActivityFilterClauses(
  filters: Pick<
    ActivityListFilters,
    'type' | 'search' | 'authorId' | 'dateFrom' | 'dateTo' | 'pinnedOnly'
  >,
  includeCursor: boolean,
  cursorTs?: string,
  cursorId?: string,
): { conditions: string[]; params: (string | number)[] } {
  const conditions: string[] = ['a.lead_id = $1'];
  const params: (string | number)[] = [];
  // $1 is always the lead id, bound by the caller.
  let paramIndex = 1;

  const push = (value: string | number): string => {
    paramIndex += 1;
    params.push(value);
    return `$${paramIndex}`;
  };

  if (filters.type) {
    conditions.push(`a.type = ${push(filters.type)}`);
  }
  if (filters.pinnedOnly) {
    conditions.push(`a.type = 'note'`);
    conditions.push(`COALESCE((a.metadata->>'pinned')::boolean, false) = true`);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const p = push(pattern);
    conditions.push(
      `(a.metadata->>'note' ILIKE ${p} OR a.metadata->>'outcome_label' ILIKE ${p} OR u.name ILIKE ${p})`,
    );
  }
  if (filters.authorId) {
    conditions.push(`a.user_id = ${push(filters.authorId)}`);
  }
  if (filters.dateFrom) {
    conditions.push(`a.created_at >= ${push(filters.dateFrom)}`);
  }
  if (filters.dateTo) {
    conditions.push(`a.created_at <= ${push(filters.dateTo)}`);
  }
  if (includeCursor && cursorTs && cursorId) {
    const ts = push(cursorTs);
    const id = push(cursorId);
    conditions.push(`(a.created_at, a.id) < (${ts}, ${id})`);
  }

  return { conditions, params };
}

export async function findActivitiesByLeadId(
  filters: ActivityListFilters,
): Promise<ActivityListResult> {
  const { leadId, limit, offset } = filters;
  const useCursor = Boolean(filters.cursorTs && filters.cursorId);
  const { conditions, params } = buildActivityFilterClauses(
    filters,
    useCursor,
    filters.cursorTs,
    filters.cursorId,
  );

  const where = conditions.join(' AND ');

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where}`,
    [leadId, ...params],
  );

  const total = Number(countRow?.total ?? '0');

  // Fetch one extra row to determine hasMore without a second round-trip.
  const fetchLimit = limit + 1;
  let sql = `SELECT ${ACTIVITY_COLS_ALIASED},
            u.name AS user_name,
            u.email AS user_email,
            COALESCE((a.metadata->>'pinned')::boolean, false) AS is_pinned
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length + 2}`;
  const pageParams: (string | number)[] = [leadId, ...params, fetchLimit];

  if (!useCursor && offset) {
    sql += ` OFFSET $${pageParams.length + 1}`;
    pageParams.push(offset);
  }

  const rows = await query<ActivityWithUser>(sql, pageParams);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | undefined;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = encodeCursor({ ts: last.created_at, id: last.id });
  }

  return {
    items,
    meta: {
      total,
      limit,
      offset,
      hasMore,
      ...(nextCursor ? { nextCursor } : {}),
    },
  };
}

/** Author options span the full lead history, independent of loaded pages. */
export async function findActivityAuthors(
  leadId: string,
): Promise<import('./activities.schema').ActivityAuthor[]> {
  return query<import('./activities.schema').ActivityAuthor>(
    `SELECT DISTINCT a.user_id AS id, u.name
       FROM activities a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.lead_id = $1 AND a.user_id IS NOT NULL
      ORDER BY u.name ASC NULLS LAST, a.user_id ASC`,
    [leadId],
  );
}
