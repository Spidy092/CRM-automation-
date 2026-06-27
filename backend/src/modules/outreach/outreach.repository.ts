import { query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { OutreachLogRow, SequenceRow, TaskRow, TimelineEntry } from './outreach.types';

// ── Outreach Sequences ─────────────────────────────────────────────────────

const SEQ_COLS = `id, name, steps, created_by, created_at, updated_at`;

export async function findSequences(limit: number, offset: number): Promise<SequenceRow[]> {
  return query<SequenceRow>(
    `SELECT ${SEQ_COLS} FROM outreach_sequences ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export async function findSequenceById(id: string): Promise<SequenceRow | null> {
  return queryOne<SequenceRow>(`SELECT ${SEQ_COLS} FROM outreach_sequences WHERE id = $1`, [id]);
}

export async function insertSequence(data: {
  name: string;
  steps: unknown[];
  created_by: string;
}): Promise<SequenceRow> {
  const row = await queryOne<SequenceRow>(
    `INSERT INTO outreach_sequences (name, steps, created_by)
     VALUES ($1, $2::jsonb, $3)
     RETURNING ${SEQ_COLS}`,
    [data.name, JSON.stringify(data.steps), data.created_by],
  );
  if (!row) throw new AppError('Failed to create sequence', 500);
  return row;
}

export async function updateSequence(
  id: string,
  fields: Partial<{ name: string; steps: unknown[] }>,
): Promise<SequenceRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.steps !== undefined) {
    sets.push(`steps = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.steps));
  }

  if (sets.length === 0) {
    const existing = await findSequenceById(id);
    if (!existing) throw new AppError('Sequence not found', 404);
    return existing;
  }

  params.push(id);
  const sql = `UPDATE outreach_sequences SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${SEQ_COLS}`;
  const row = await queryOne<SequenceRow>(sql, params);
  if (!row) throw new AppError('Sequence not found', 404);
  return row;
}

export async function deleteSequence(id: string): Promise<void> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM outreach_sequences WHERE id = $1 RETURNING id',
    [id],
  );
  if (!result) throw new AppError('Sequence not found', 404);
}

// ── Outreach Logs ──────────────────────────────────────────────────────────

const LOG_COLS = `id, lead_id, campaign_id, channel, template_id, step_number, status,
  external_msg_id, message_body, sent_at, delivered_at, opened_at, replied_at,
  error_message, created_at, updated_at`;

export async function insertOutreachLog(data: {
  lead_id: string;
  campaign_id: string | null;
  channel: string;
  template_id: string | null;
  step_number: number | null;
  status: string;
  message_body: string | null;
}): Promise<OutreachLogRow> {
  const row = await queryOne<OutreachLogRow>(
    `INSERT INTO outreach_logs
      (lead_id, campaign_id, channel, template_id, step_number, status, message_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${LOG_COLS}`,
    [
      data.lead_id,
      data.campaign_id,
      data.channel,
      data.template_id,
      data.step_number,
      data.status,
      data.message_body,
    ],
  );
  if (!row) throw new AppError('Failed to insert outreach log', 500);
  return row;
}

export async function updateOutreachLogStatus(
  id: string,
  status: string,
  extra?: Partial<{
    sentAt: string;
    deliveredAt: string;
    openedAt: string;
    repliedAt: string;
    errorMessage: string;
    externalMsgId: string;
  }>,
): Promise<OutreachLogRow> {
  const sets: string[] = [`status = $1`];
  const params: unknown[] = [status];
  let i = 2;

  if (extra?.externalMsgId !== undefined) {
    sets.push(`external_msg_id = $${i++}`);
    params.push(extra.externalMsgId);
  }
  if (extra?.sentAt !== undefined) {
    sets.push(`sent_at = $${i++}`);
    params.push(extra.sentAt);
  }
  if (extra?.deliveredAt !== undefined) {
    sets.push(`delivered_at = $${i++}`);
    params.push(extra.deliveredAt);
  }
  if (extra?.openedAt !== undefined) {
    sets.push(`opened_at = $${i++}`);
    params.push(extra.openedAt);
  }
  if (extra?.repliedAt !== undefined) {
    sets.push(`replied_at = $${i++}`);
    params.push(extra.repliedAt);
  }
  if (extra?.errorMessage !== undefined) {
    sets.push(`error_message = $${i++}`);
    params.push(extra.errorMessage);
  }

  params.push(id);
  const sql = `UPDATE outreach_logs SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${LOG_COLS}`;
  const row = await queryOne<OutreachLogRow>(sql, params);
  if (!row) throw new AppError('Log not found', 404);
  return row;
}

export async function findLogsByLead(leadId: string, limit: number): Promise<OutreachLogRow[]> {
  return query<OutreachLogRow>(
    `SELECT ${LOG_COLS} FROM outreach_logs WHERE lead_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [leadId, limit],
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────

const TASK_COLS = `id, lead_id, campaign_id, sequence_id, step_number, assigned_to,
  type, title, description, due_at, status, completed_at, created_by, created_at, updated_at`;

export async function insertTask(data: {
  lead_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  step_number: number | null;
  assigned_to: string | null;
  type: string;
  title: string;
  description: string | null;
  due_at: string | null;
  created_by: string;
}): Promise<TaskRow> {
  const row = await queryOne<TaskRow>(
    `INSERT INTO tasks
      (lead_id, campaign_id, sequence_id, step_number, assigned_to, type, title, description, due_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${TASK_COLS}`,
    [
      data.lead_id,
      data.campaign_id,
      data.sequence_id,
      data.step_number,
      data.assigned_to,
      data.type,
      data.title,
      data.description,
      data.due_at,
      data.created_by,
    ],
  );
  if (!row) throw new AppError('Failed to create task', 500);
  return row;
}

export async function findTaskById(id: string): Promise<TaskRow | null> {
  return queryOne<TaskRow>(`SELECT ${TASK_COLS} FROM tasks WHERE id = $1`, [id]);
}

export async function findTasks(filters: {
  status?: string;
  assignedTo?: string;
  limit: number;
}): Promise<TaskRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.status) {
    conditions.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.assignedTo) {
    conditions.push(`assigned_to = $${i++}`);
    params.push(filters.assignedTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(filters.limit);
  return query<TaskRow>(
    `SELECT ${TASK_COLS} FROM tasks ${where} ORDER BY due_at ASC NULLS LAST, created_at DESC LIMIT $${i}`,
    params,
  );
}


export async function updateTask(
  id: string,
  fields: Partial<{
    assigned_to: string | null;
    status: string;
    due_at: string | null;
    title: string;
    description: string | null;
    completed_at: string | null;
  }>,
): Promise<TaskRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.assigned_to !== undefined) {
    sets.push(`assigned_to = $${i++}`);
    params.push(fields.assigned_to);
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(fields.status);
    if (fields.status === 'completed') {
      sets.push(`completed_at = NOW()`);
    }
  }
  if (fields.due_at !== undefined) {
    sets.push(`due_at = $${i++}`);
    params.push(fields.due_at);
  }
  if (fields.title !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(fields.title);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(fields.description);
  }

  if (sets.length === 0) {
    const existing = await findTaskById(id);
    if (!existing) throw new AppError('Task not found', 404);
    return existing;
  }

  params.push(id);
  const sql = `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${TASK_COLS}`;
  const row = await queryOne<TaskRow>(sql, params);
  if (!row) throw new AppError('Task not found', 404);
  return row;
}

// ── Lead Activity Timeline ─────────────────────────────────────────────────

export async function findTimelineByLead(leadId: string, limit: number): Promise<TimelineEntry[]> {
  return query<TimelineEntry>(
    `SELECT
        id,
        'outreach_log' AS type,
        lead_id,
        campaign_id,
        status,
        channel,
        message_body AS body,
        created_at
      FROM outreach_logs
      WHERE lead_id = $1
    UNION ALL
    SELECT
        id,
        'task' AS type,
        lead_id,
        campaign_id,
        status,
        type AS channel,
        description AS body,
        created_at
      FROM tasks
      WHERE lead_id = $1
    ORDER BY created_at DESC
    LIMIT $2`,
    [leadId, limit],
  );
}
