import { query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { TemplateAttachment, TemplateListFilters, TemplateRow } from './templates.types';

const COLS = `id, name, channel, subject, body, variables, attachments, approval_status, approved_by, approved_at, rejection_reason, created_by, created_at, updated_at`;

export async function findTemplates(
  filters: TemplateListFilters,
): Promise<{ rows: TemplateRow[]; hasMore: boolean }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.channel) {
    conditions.push(`channel = $${i++}`);
    params.push(filters.channel);
  }
  if (filters.approval_status) {
    conditions.push(`approval_status = $${i++}`);
    params.push(filters.approval_status);
  }
  if (filters.search) {
    conditions.push(`(name ILIKE $${i} OR body ILIKE $${i})`);
    params.push(`%${filters.search}%`);
    i++;
  }
  if (filters.cursorTs && filters.cursorId) {
    conditions.push(`(created_at, id) < ($${i}, $${i + 1})`);
    params.push(filters.cursorTs, filters.cursorId);
    i += 2;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const fetchLimit = filters.limit + 1;

  const sql = `SELECT ${COLS} FROM templates ${whereClause}
    ORDER BY created_at DESC, id DESC LIMIT $${i}`;
  params.push(fetchLimit);

  const rows = await query<TemplateRow>(sql, params);
  const hasMore = rows.length > filters.limit;
  const trimmed = hasMore ? rows.slice(0, filters.limit) : rows;
  return { rows: trimmed, hasMore };
}

export async function findTemplateById(id: string): Promise<TemplateRow | null> {
  return queryOne<TemplateRow>(`SELECT ${COLS} FROM templates WHERE id = $1`, [id]);
}

export async function insertTemplate(data: {
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  created_by: string;
  /**
   * When set, the template is created already approved and attributed to this user.
   * Callers pass this only for actors who could immediately approve it anyway — it
   * removes a redundant round-trip, never a permission check. Leave null to fall back
   * to the column default of 'pending'.
   */
  approved_by?: string | null;
}): Promise<TemplateRow> {
  const approvedBy = data.approved_by ?? null;
  const row = await queryOne<TemplateRow>(
    `INSERT INTO templates (name, channel, subject, body, variables, created_by, approval_status, approved_by, approved_at)
     VALUES ($1, $2, $3, $4, $5, $6,
             (CASE WHEN $7::uuid IS NULL THEN 'pending' ELSE 'approved' END)::template_approval_status,
             $7::uuid,
             CASE WHEN $7::uuid IS NULL THEN NULL ELSE NOW() END)
     RETURNING ${COLS}`,
    [data.name, data.channel, data.subject, data.body, data.variables, data.created_by, approvedBy],
  );
  if (!row) throw new AppError('Failed to create template', 500);
  return row;
}

export async function appendTemplateAttachment(
  id: string,
  attachment: TemplateAttachment,
): Promise<TemplateRow> {
  const row = await queryOne<TemplateRow>(
    `UPDATE templates SET attachments = attachments || $1::jsonb WHERE id = $2 RETURNING ${COLS}`,
    [JSON.stringify([attachment]), id],
  );
  if (!row) throw new AppError('Template not found', 404);
  return row;
}

export async function removeTemplateAttachment(
  id: string,
  attachmentId: string,
): Promise<TemplateRow> {
  const row = await queryOne<TemplateRow>(
    `UPDATE templates
     SET attachments = COALESCE(
       (SELECT jsonb_agg(a) FROM jsonb_array_elements(attachments) a WHERE a->>'id' != $2),
       '[]'::jsonb
     )
     WHERE id = $1
     RETURNING ${COLS}`,
    [id, attachmentId],
  );
  if (!row) throw new AppError('Template not found', 404);
  return row;
}

export async function updateTemplate(
  id: string,
  fields: Partial<{
    name: string;
    channel: string;
    subject: string | null;
    body: string;
    variables: string[];
  }>,
): Promise<TemplateRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.channel !== undefined) {
    sets.push(`channel = $${i++}`);
    params.push(fields.channel);
  }
  if (fields.subject !== undefined) {
    sets.push(`subject = $${i++}`);
    params.push(fields.subject);
  }
  if (fields.body !== undefined) {
    sets.push(`body = $${i++}`);
    params.push(fields.body);
  }
  if (fields.variables !== undefined) {
    sets.push(`variables = $${i++}`);
    params.push(fields.variables);
  }

  if (sets.length === 0) {
    const existing = await findTemplateById(id);
    if (!existing) throw new AppError('Template not found', 404);
    return existing;
  }

  params.push(id);
  const sql = `UPDATE templates SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLS}`;
  const row = await queryOne<TemplateRow>(sql, params);
  if (!row) throw new AppError('Template not found', 404);
  return row;
}

export async function setApprovalStatus(
  id: string,
  status: 'pending' | 'approved' | 'rejected',
  approvedBy: string | null,
  rejectionReason: string | null,
): Promise<TemplateRow> {
  const row = await queryOne<TemplateRow>(
    `UPDATE templates
     SET approval_status = $1,
         approved_by = $2,
         approved_at = CASE WHEN $5 = 'approved' THEN NOW() ELSE NULL END,
         rejection_reason = $3
     WHERE id = $4
     RETURNING ${COLS}`,
    [status, approvedBy, rejectionReason, id, status],
  );
  if (!row) throw new AppError('Template not found', 404);
  return row;
}

export async function deleteTemplate(id: string): Promise<void> {
  const result = await queryOne<{ id: string }>(
    'DELETE FROM templates WHERE id = $1 RETURNING id',
    [id],
  );
  if (!result) throw new AppError('Template not found', 404);
}
