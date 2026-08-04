import { query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { FormRow, FormSubmissionRow, FormFieldDef } from './forms.types';

const FORM_COLS = `id, name, slug, description, fields, submit_action, submit_message,
  redirect_url, is_active, theme, email_settings, created_by, created_at, updated_at, deleted_at`;

function parseFields(raw: unknown): FormFieldDef[] {
  if (Array.isArray(raw)) return raw as FormFieldDef[];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as FormFieldDef[];
    } catch {
      return [];
    }
  }
  return [];
}

function mapFormRow(row: FormRow & { fields: unknown; email_settings: unknown }): FormRow {
  const rawSettings = row.email_settings;
  const emailSettingsObj =
    typeof rawSettings === 'string'
      ? (JSON.parse(rawSettings) as Record<string, unknown>)
      : (rawSettings as Record<string, unknown> | null);
  return {
    ...row,
    fields: parseFields(row.fields),
    email_settings: (emailSettingsObj as FormRow['email_settings']) || {},
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function findForms(limit: number, offset: number): Promise<FormRow[]> {
  const rows = await query<FormRow & { fields: unknown }>(
    `SELECT ${FORM_COLS} FROM forms WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map(mapFormRow);
}

export async function countForms(): Promise<number> {
  const row = await queryOne<{ total: string }>(
    'SELECT COUNT(*) as total FROM forms WHERE deleted_at IS NULL',
  );
  return parseInt(row?.total ?? '0', 10);
}

export async function findFormById(id: string): Promise<FormRow | null> {
  const row = await queryOne<FormRow & { fields: unknown }>(
    `SELECT ${FORM_COLS} FROM forms WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return row ? mapFormRow(row) : null;
}

export async function findFormBySlug(slug: string): Promise<FormRow | null> {
  const row = await queryOne<FormRow & { fields: unknown }>(
    `SELECT ${FORM_COLS} FROM forms WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );
  return row ? mapFormRow(row) : null;
}

export async function insertForm(data: {
  name: string;
  slug: string;
  description: string | null;
  fields: FormFieldDef[];
  submit_action: string;
  submit_message: string;
  redirect_url: string | null;
  is_active: boolean;
  theme: Record<string, unknown>;
  email_settings?: Record<string, unknown>;
  created_by: string;
}): Promise<FormRow> {
  const row = await queryOne<FormRow & { fields: unknown; email_settings: unknown }>(
    `INSERT INTO forms (name, slug, description, fields, submit_action, submit_message,
       redirect_url, is_active, theme, email_settings, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
     RETURNING ${FORM_COLS}`,
    [
      data.name,
      data.slug,
      data.description,
      JSON.stringify(data.fields),
      data.submit_action,
      data.submit_message,
      data.redirect_url,
      data.is_active,
      JSON.stringify(data.theme),
      JSON.stringify(data.email_settings || {}),
      data.created_by,
    ],
  );
  if (!row) throw new AppError('Failed to create form', 500);
  return mapFormRow(row);
}

export async function updateForm(
  id: string,
  fields: Partial<{
    name: string;
    slug: string;
    description: string | null;
    fields: FormFieldDef[];
    submit_action: string;
    submit_message: string;
    redirect_url: string | null;
    is_active: boolean;
    theme: Record<string, unknown>;
    email_settings: Record<string, unknown>;
  }>,
): Promise<FormRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.slug !== undefined) {
    sets.push(`slug = $${i++}`);
    params.push(fields.slug);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(fields.description ?? null);
  }
  if (fields.fields !== undefined) {
    sets.push(`fields = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.fields));
  }
  if (fields.submit_action !== undefined) {
    sets.push(`submit_action = $${i++}`);
    params.push(fields.submit_action);
  }
  if (fields.submit_message !== undefined) {
    sets.push(`submit_message = $${i++}`);
    params.push(fields.submit_message);
  }
  if (fields.redirect_url !== undefined) {
    sets.push(`redirect_url = $${i++}`);
    params.push(fields.redirect_url ?? null);
  }
  if (fields.is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(fields.is_active);
  }
  if (fields.theme !== undefined) {
    sets.push(`theme = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.theme));
  }
  if (fields.email_settings !== undefined) {
    sets.push(`email_settings = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.email_settings));
  }

  if (sets.length === 0) {
    const existing = await findFormById(id);
    if (!existing) throw new AppError('Form not found', 404);
    return existing;
  }

  params.push(id);
  const sql = `UPDATE forms SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING ${FORM_COLS}`;
  const row = await queryOne<FormRow & { fields: unknown; email_settings: unknown }>(sql, params);
  if (!row) throw new AppError('Form not found', 404);
  return mapFormRow(row);
}

export async function deleteForm(id: string): Promise<void> {
  const result = await queryOne<{ id: string }>(
    'UPDATE forms SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
    [id],
  );
  if (!result) throw new AppError('Form not found', 404);
}

// ── Submissions ───────────────────────────────────────────────────────────

export async function insertSubmission(data: {
  form_id: string;
  lead_id: string | null;
  data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  referrer: string | null;
}): Promise<FormSubmissionRow> {
  const row = await queryOne<FormSubmissionRow>(
    `INSERT INTO form_submissions (form_id, lead_id, data, ip_address, user_agent, referrer)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     RETURNING id, form_id, lead_id, data, ip_address, user_agent, referrer, status, created_at`,
    [
      data.form_id,
      data.lead_id,
      JSON.stringify(data.data),
      data.ip_address,
      data.user_agent,
      data.referrer,
    ],
  );
  if (!row) throw new AppError('Failed to record submission', 500);
  return row;
}

export async function getFormAnalytics(formId: string): Promise<{
  totalSubmissions: number;
  uniqueLeads: number;
  submissionsByDay: { date: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
}> {
  const totals = await queryOne<{ total: string; unique_leads: string }>(
    `SELECT COUNT(*) as total, COUNT(DISTINCT lead_id) FILTER (WHERE lead_id IS NOT NULL) as unique_leads
     FROM form_submissions WHERE form_id = $1`,
    [formId],
  );

  const byDay = await query<{ date: string; count: string }>(
    `SELECT DATE(created_at) as date, COUNT(*) as count
     FROM form_submissions WHERE form_id = $1
     GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`,
    [formId],
  );

  const referrers = await query<{ referrer: string; count: string }>(
    `SELECT COALESCE(referrer, 'Direct') as referrer, COUNT(*) as count
     FROM form_submissions WHERE form_id = $1
     GROUP BY referrer ORDER BY count DESC LIMIT 10`,
    [formId],
  );

  return {
    totalSubmissions: parseInt(totals?.total ?? '0', 10),
    uniqueLeads: parseInt(totals?.unique_leads ?? '0', 10),
    submissionsByDay: byDay.map((r) => ({ date: r.date, count: parseInt(r.count, 10) })),
    topReferrers: referrers.map((r) => ({ referrer: r.referrer, count: parseInt(r.count, 10) })),
  };
}
