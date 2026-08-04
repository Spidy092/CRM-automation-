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
  FormEmailStatus,
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
import * as sendgrid from '../integrations/sendgrid/sendgrid.connector';
import * as smtp from '../integrations/smtp/smtp.connector';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderTemplate(template: string, data: Record<string, unknown>): string {
  if (!template) return '';
  const map = data as Record<string, string | number | boolean | null | undefined>;
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const val = map[key as keyof typeof map];
    return val !== undefined && val !== null ? escapeHtml(String(val)) : match;
  });
}

async function sendSystemEmail(
  to: string,
  subject: string,
  htmlBody: string,
  leadId?: string,
  fromEmail?: string,
  fromName?: string,
): Promise<{ ok: boolean; error?: string }> {
  const emailInput = {
    to,
    subject,
    htmlBody,
    leadId: leadId ?? 'system',
    fromEmail,
    fromName,
  };

  try {
    const sgRes = await sendgrid.sendEmail(emailInput);
    if (sgRes?.ok) return { ok: true };
    if (sgRes && !sgRes.ok) {
      const errDetail =
        'error' in sgRes && typeof sgRes.error === 'string' ? sgRes.error : undefined;
      logger.warn('SendGrid failed for system email, falling back to SMTP', { error: errDetail });
    }
  } catch (err) {
    logger.warn('SendGrid failed for system email, falling back to SMTP', {
      error: (err as Error).message,
    });
  }

  try {
    const smtpRes = await smtp.sendEmail(emailInput);
    if (smtpRes?.ok) return { ok: true };
    const errDetail =
      smtpRes && 'error' in smtpRes && typeof smtpRes.error === 'string'
        ? smtpRes.error
        : 'SMTP failed to send email';
    return { ok: false, error: errDetail };
  } catch (err) {
    const error = (err as Error).message;
    logger.error('SMTP failed for system email', { error });
    return { ok: false, error };
  }
}

async function dispatchFormEmails(
  form: FormRow,
  data: Record<string, unknown>,
  leadId?: string,
): Promise<FormEmailStatus> {
  const settings = form.email_settings;
  if (!settings) {
    return { success: true, sentCount: 0, failedCount: 0 };
  }

  const getEmailAddress = (field: string) => {
    const rendered = renderTemplate(field, data);
    return rendered
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  };

  let sentCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  // 1. Auto Reply
  if (settings.autoReply?.enabled) {
    const toEmail = String(data.email || data.contact_email || '');
    if (toEmail && toEmail.includes('@')) {
      const res = await sendSystemEmail(
        toEmail,
        renderTemplate(settings.autoReply.subject, data),
        renderTemplate(settings.autoReply.body, data),
        leadId,
        settings.autoReply.fromEmail,
        settings.autoReply.fromName,
      );
      if (res.ok) {
        sentCount++;
      } else {
        failedCount++;
        if (res.error) errors.push(`AutoReply: ${res.error}`);
      }
    }
  }

  // 2. Team Notification
  if (settings.teamNotification?.enabled && settings.teamNotification.emails) {
    const emails = getEmailAddress(settings.teamNotification.emails);
    for (const to of emails) {
      const res = await sendSystemEmail(
        to,
        renderTemplate(settings.teamNotification.subject, data),
        renderTemplate(settings.teamNotification.body, data),
        leadId,
      );
      if (res.ok) {
        sentCount++;
      } else {
        failedCount++;
        if (res.error) errors.push(`TeamNotification (${to}): ${res.error}`);
      }
    }
  }

  // 3. Partner Notification
  if (settings.partnerNotification?.enabled && settings.partnerNotification.emails) {
    const emails = getEmailAddress(settings.partnerNotification.emails);
    for (const to of emails) {
      const res = await sendSystemEmail(
        to,
        renderTemplate(settings.partnerNotification.subject, data),
        renderTemplate(settings.partnerNotification.body, data),
        leadId,
      );
      if (res.ok) {
        sentCount++;
      } else {
        failedCount++;
        if (res.error) errors.push(`PartnerNotification (${to}): ${res.error}`);
      }
    }
  }

  return {
    success: failedCount === 0,
    sentCount,
    failedCount,
    ...(errors.length > 0 ? { errors } : {}),
  };
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
  if (!row) throw new AppError('Form not found', 404);
  if (!row.is_active) throw new AppError('Form is currently inactive', 403);
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
    email_settings: (input.email_settings as unknown as Record<string, unknown>) ?? {},
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
    email_settings: input.email_settings as unknown as Record<string, unknown>,
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
  emailStatus?: FormEmailStatus;
}> {
  const form = await findFormById(formId);
  if (!form) throw new AppError('Form not found', 404);
  if (!form.is_active) throw new AppError('Form is not accepting submissions', 400);

  // Validate fields against definition
  for (const field of form.fields) {
    const val = data[field.name];
    if (field.required && !val && val !== 0 && val !== false) {
      throw new AppError(`Field "${field.label}" is required`, 422);
    }

    if (val !== undefined && val !== null && val !== '') {
      if (
        field.type === 'email' &&
        typeof val === 'string' &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
      ) {
        throw new AppError(`Field "${field.label}" must be a valid email address`, 422);
      }
      if (
        field.type === 'select' &&
        field.options &&
        field.options.length > 0 &&
        typeof val === 'string'
      ) {
        if (!field.options.includes(val)) {
          throw new AppError(`Invalid selection for field "${field.label}"`, 422);
        }
      }
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

  // Dispatch Emails based on form.email_settings
  let emailStatus: FormEmailStatus | undefined;
  try {
    emailStatus = await dispatchFormEmails(form, data, leadId);
    if (!emailStatus.success) {
      logger.warn('Form submission emails had failures', { formId: form.id, emailStatus });
    }
  } catch (err) {
    const errorMsg = (err as Error).message;
    logger.error('Failed to dispatch form emails', { formId: form.id, error: errorMsg });
    emailStatus = { success: false, sentCount: 0, failedCount: 1, errors: [errorMsg] };
  }

  return {
    submission,
    leadId,
    message: form.submit_message,
    redirectUrl: form.redirect_url ?? undefined,
    emailStatus,
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
