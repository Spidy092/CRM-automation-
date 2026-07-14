import { query, queryOne } from '../../shared/utils/db';
import {
  Activity,
  ActivityListFilters,
  ActivityListResult,
  ActivityWithUser,
  CreateActivityInput,
} from './activities.types';

const ACTIVITY_COLS = 'id, lead_id, user_id, type, metadata, created_at';

export async function insertActivity(input: CreateActivityInput): Promise<Activity> {
  const row = await queryOne<Activity>(
    `INSERT INTO activities (lead_id, user_id, type, metadata)
     VALUES ($1, $2, $3, COALESCE($4, '{}'))
     RETURNING ${ACTIVITY_COLS}`,
    [input.lead_id, input.user_id, input.type, input.metadata ?? {}],
  );
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

export async function findActivitiesByLeadId(
  filters: ActivityListFilters,
): Promise<ActivityListResult> {
  const { leadId, limit, offset, type } = filters;
  const conditions = ['a.lead_id = $1'];
  const params: (string | number)[] = [leadId];
  let paramIndex = 1;

  if (type) {
    paramIndex += 1;
    conditions.push(`a.type = $${paramIndex}`);
    params.push(type);
  }

  const where = conditions.join(' AND ');

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM activities a
      WHERE ${where}`,
    params,
  );

  const total = Number(countRow?.total ?? '0');

  const items = await query<ActivityWithUser>(
    `SELECT ${ACTIVITY_COLS},
            u.name AS user_name,
            u.email AS user_email
       FROM activities a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
    [...params, limit, offset],
  );

  return {
    items,
    meta: {
      total,
      limit,
      offset,
    },
  };
}
