import { pool, queryOne } from '../../shared/utils/db';
import type { AiInboxItem, CreateInboxItemInput, ActionInboxItemInput, ListInboxItemsOptions } from './ai-inbox.types';

export async function createInboxItem(input: CreateInboxItemInput): Promise<AiInboxItem> {
  const row = await queryOne<AiInboxItem>(
    `INSERT INTO ai_inbox_items
       (assigned_to, lead_id, campaign_id, item_type, title, summary,
        urgency_score, ai_draft_response, ai_draft_confidence, expires_at,
        status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',NOW(),NOW())
     RETURNING *`,
    [
      input.assigned_to,
      input.lead_id ?? null,
      input.campaign_id ?? null,
      input.item_type,
      input.title,
      input.summary ?? null,
      input.urgency_score,
      input.ai_draft_response ?? null,
      input.ai_draft_confidence ?? null,
      input.expires_at ?? null,
    ],
  );
  if (!row) throw new Error('Failed to create inbox item');
  return row;
}

export async function findInboxItems(opts: ListInboxItemsOptions): Promise<AiInboxItem[]> {
  const conditions: string[] = ['assigned_to = $1'];
  const params: unknown[] = [opts.assigned_to];
  let idx = 2;

  if (opts.status) {
    conditions.push(`status = $${idx++}`);
    params.push(opts.status);
  } else {
    // Default: exclude auto_resolved
    conditions.push(`status != 'auto_resolved'`);
  }

  if (opts.item_type) {
    conditions.push(`item_type = $${idx++}`);
    params.push(opts.item_type);
  }

  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;

  const result = await pool.query<AiInboxItem>(
    `SELECT * FROM ai_inbox_items
     WHERE ${conditions.join(' AND ')}
     ORDER BY urgency_score DESC, created_at ASC
     LIMIT $${idx++} OFFSET $${idx}`,
    [...params, limit, offset],
  );

  return result.rows;
}

export async function countInboxItems(assignedTo: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ai_inbox_items
     WHERE assigned_to = $1 AND status = 'pending'`,
    [assignedTo],
  );
  return parseInt(row?.count ?? '0', 10);
}

export async function findInboxItemById(id: string): Promise<AiInboxItem | null> {
  return queryOne<AiInboxItem>(
    `SELECT * FROM ai_inbox_items WHERE id = $1`,
    [id],
  );
}

export async function actionInboxItem(id: string, input: ActionInboxItemInput): Promise<AiInboxItem | null> {
  return queryOne<AiInboxItem>(
    `UPDATE ai_inbox_items
     SET status       = $2,
         actioned_by  = $3,
         actioned_at  = CASE WHEN $2 = 'actioned' THEN NOW() ELSE actioned_at END,
         snoozed_until = $4,
         updated_at   = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      input.status,
      input.actioned_by ?? null,
      input.snoozed_until ?? null,
    ],
  );
}

/** Auto-resolve all pending inbox items for a lead when action is taken elsewhere. */
export async function autoResolveItemsForLead(leadId: string): Promise<void> {
  await pool.query(
    `UPDATE ai_inbox_items
     SET status = 'auto_resolved', updated_at = NOW()
     WHERE lead_id = $1 AND status = 'pending'`,
    [leadId],
  );
}

/** Expire guarded-mode items: update status to 'actioned' so downstream can auto-send. */
export async function expireGuardedItems(): Promise<Array<{ id: string; lead_id: string | null; ai_draft_response: string | null }>> {
  const result = await pool.query<{ id: string; lead_id: string | null; ai_draft_response: string | null }>(
    `UPDATE ai_inbox_items
     SET status = 'actioned', actioned_at = NOW(), updated_at = NOW()
     WHERE status = 'pending'
       AND item_type = 'approve_response'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
     RETURNING id, lead_id, ai_draft_response`,
  );
  return result.rows;
}
