import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  FormRow,
  FormSubmissionRow,
  FormAnalytics,
  CreateFormInput,
  UpdateFormInput,
  FormActor,
} from './forms.types';
import {
  findForms,
  countForms,
  findFormById,
  findFormBySlug,
  insertForm,
  updateForm,
  deleteForm,
  insertSubmission,
  getFormAnalytics,
} from './forms.repository';
import { insertLead } from '../leads/leads.repository';
import { clampLimit } from '../../shared/utils/pagination';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function listForms(
  limit?: number,
  offset?: number,
): Promise<{
  items: FormRow[];
  meta: { limit: number; offset: number; total: number };
}> {
  const safeLimit = clampLimit(limit);
  const safeOffset = Math.max(0, offset ?? 0);
  const [items, total] = await Promise.all([findForms(safeLimit, safeOffset), countForms()]);
  return { items, meta: { limit: safeLimit, offset: safeOffset, total } };
}

export async function getForm(id: string): Promise<FormRow> {
  const row = await findFormById(id);
  if (!row) throw new AppError('Form not found', 404);
  return row;
}

export async function getFormBySlug(slug: string): Promise<FormRow> {
  const row = await findFormBySlug(slug);
  if (!row) throw new AppError('Form not found or inactive', 404);
  return row;
}

export async function createForm(input: CreateFormInput, actor: FormActor): Promise<FormRow> {
  const slug = input.slug || slugify(input.name);

  // Check slug uniqueness
  const existing = await findFormBySlug(slug);
  if (existing) throw new AppError('A form with this slug already exists', 409);

  const row = await insertForm({
    name: input.name,
    slug,
    description: input.description ?? null,
    fields: input.fields,
    submit_action: input.submit_action ?? 'create_lead',
    submit_message: input.submit_message ?? 'Thank you for your submission!',
    redirect_url: input.redirect_url ?? null,
    is_active: input.is_active ?? true,
    theme: input.theme ?? {},
    created_by: actor.id,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'form.created',
    entityType: 'form',
    entityId: row.id,
    newValue: { name: row.name, slug: row.slug },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function updateFormById(
  id: string,
  input: UpdateFormInput,
  actor: FormActor,
): Promise<FormRow> {
  const existing = await findFormById(id);
  if (!existing) throw new AppError('Form not found', 404);

  // If slug is changing, check uniqueness
  if (input.slug && input.slug !== existing.slug) {
    const dup = await findFormBySlug(input.slug);
    if (dup) throw new AppError('A form with this slug already exists', 409);
  }

  const row = await updateForm(id, {
    name: input.name,
    slug: input.slug ? slugify(input.slug) : undefined,
    description: input.description,
    fields: input.fields,
    submit_action: input.submit_action,
    submit_message: input.submit_message,
    redirect_url: input.redirect_url,
    is_active: input.is_active,
    theme: input.theme,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'form.updated',
    entityType: 'form',
    entityId: id,
    oldValue: { name: existing.name, slug: existing.slug },
    newValue: { name: row.name, slug: row.slug },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function deleteFormById(id: string, actor: FormActor): Promise<void> {
  const existing = await findFormById(id);
  if (!existing) throw new AppError('Form not found', 404);

  await deleteForm(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'form.deleted',
    entityType: 'form',
    entityId: id,
    oldValue: { name: existing.name },
    ipAddress: actor.ipAddress ?? null,
  });
}

// ── Public Submission ─────────────────────────────────────────────────────

export async function submitForm(
  formId: string,
  data: Record<string, unknown>,
  meta: { ipAddress?: string; userAgent?: string; referrer?: string },
): Promise<{
  submission: FormSubmissionRow;
  leadId?: string;
  message: string;
  redirectUrl?: string;
}> {
  const form = await findFormById(formId);
  if (!form) throw new AppError('Form not found', 404);
  if (!form.is_active) throw new AppError('Form is not accepting submissions', 400);

  // Validate required fields
  for (const field of form.fields) {
    if (
      field.required &&
      !data[field.name] &&
      data[field.name] !== 0 &&
      data[field.name] !== false
    ) {
      throw new AppError(`Field "${field.label}" is required`, 422);
    }
  }

  let leadId: string | undefined;

  // Create lead if submit_action is 'create_lead'
  if (form.submit_action === 'create_lead') {
    try {
      // Map form fields to lead fields using leadField mapping
      const leadData: Record<string, string> = {};
      for (const field of form.fields) {
        if (field.leadField && data[field.name] !== undefined) {
          leadData[field.leadField] = String(data[field.name]);
        }
      }

      const lead = await insertLead({
        business_name: String(
          leadData.company ||
            leadData.business_name ||
            data.company ||
            data.business_name ||
            'Web Form Lead',
        ),
        contact_name: String(
          leadData.contact_name ||
            leadData.name ||
            data.name ||
            data.contact_name ||
            'Website Visitor',
        ),
        phone: String(leadData.phone || data.phone || ''),
        email: String(leadData.email || data.email || `form_${Date.now()}@placeholder.local`),
        website: leadData.website || (data.website as string) || null,
        industry: String(leadData.industry || data.industry || 'Unknown'),
        location: String(leadData.location || data.location || 'Unknown'),
        source_platform: 'website_form',
        notes: JSON.stringify(data),
      });
      leadId = lead.id;
    } catch (err) {
      logger.warn('Failed to create lead from form submission', {
        formId,
        error: (err as Error).message,
      });
    }
  }

  // Record the submission
  const submission = await insertSubmission({
    form_id: formId,
    lead_id: leadId ?? null,
    data,
    ip_address: meta.ipAddress ?? null,
    user_agent: meta.userAgent ?? null,
    referrer: meta.referrer ?? null,
  });

  return {
    submission,
    leadId,
    message: form.submit_message,
    redirectUrl: form.redirect_url ?? undefined,
  };
}

// ── Analytics ─────────────────────────────────────────────────────────────

export async function getFormAnalyticsById(
  formId: string,
  _actor: FormActor,
): Promise<FormAnalytics> {
  const form = await findFormById(formId);
  if (!form) throw new AppError('Form not found', 404);

  const analytics = await getFormAnalytics(formId);
  const conversionRate =
    analytics.totalSubmissions > 0 ? (analytics.uniqueLeads / analytics.totalSubmissions) * 100 : 0;

  return {
    formId: form.id,
    formName: form.name,
    ...analytics,
    conversionRate: Math.round(conversionRate * 100) / 100,
  };
}

/**
 * Generate an embeddable HTML snippet for a form.
 */
export function generateEmbedSnippet(form: FormRow, baseUrl: string): string {
  const formUrl = `${baseUrl}/forms/${form.slug}`;
  return `<!-- ${form.name} - Contact Form -->
<iframe
  src="${formUrl}"
  width="100%"
  height="600"
  frameborder="0"
  style="border:none;max-width:600px;"
  title="${form.name}"
  loading="lazy"
></iframe>
<p style="font-size:12px;color:#999;margin-top:4px;">
  Powered by <a href="${baseUrl}" target="_blank" rel="noopener">CRM</a>
</p>`;
}
