import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { unlink, writeFile, mkdir, copyFile } from 'fs/promises';
import path from 'path';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import { clampLimit, encodeCursor } from '../../shared/utils/pagination';
import {
  appendTemplateAttachment,
  deleteTemplate,
  findTemplateById,
  findTemplates,
  insertTemplate,
  removeTemplateAttachment as removeTemplateAttachmentRepo,
  setApprovalStatus,
  updateTemplate as updateTemplateRepo,
} from './templates.repository';
import {
  TemplateActor,
  TemplateApprovalInput,
  TemplateAttachment,
  TemplateEditorMode,
  TemplateInput,
  TemplateListFilters,
  TemplateResponse,
  TemplateRow,
} from './templates.types';
import { getFileRow } from '../files/files.service';
import {
  checkEmailCompliance,
  emailHtmlToText,
  estimateSmsSegments,
  extractVariableNames,
  findInvalidVariables,
  findUnsafeLinks,
  leadToVariableValues,
  previewValues,
  renderDesignToHtml,
  resolveEmailPayload,
  sanitizeCustomHtml,
  substituteVariables,
  validateDesign,
  validateWhatsappBody,
  type SmsEstimate,
  type TemplateDesign,
} from './templateDesign';

// ── Attachments ──────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads/templates');
const MAX_ATTACHMENTS_PER_TEMPLATE = 3;
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const ALLOWED_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
};

function publicBaseUrl(): string {
  return process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
}

function toResponse(row: {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  attachments: TemplateAttachment[];
  approval_status: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  editor_mode?: string | null;
  design?: unknown;
  html_body?: string | null;
  text_body?: string | null;
  preheader?: string | null;
  archived_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}): TemplateResponse {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel as TemplateResponse['channel'],
    subject: row.subject,
    body: row.body,
    variables: row.variables,
    // storagePath is server-only — never send an absolute disk path to the client.
    attachments: (row.attachments ?? []).map(({ storagePath: _storagePath, ...rest }) => rest),
    approval_status: row.approval_status as TemplateResponse['approval_status'],
    approved_by: row.approved_by,
    approved_at: row.approved_at,
    rejection_reason: row.rejection_reason,
    editor_mode: (row.editor_mode as TemplateEditorMode) ?? 'simple',
    design: row.design ?? null,
    html_body: row.html_body ?? null,
    text_body: row.text_body ?? null,
    preheader: row.preheader ?? null,
    archived_at: row.archived_at ?? null,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Design-system rendering ──────────────────────────────────────────────────

export interface PreparedTemplateContent {
  editor_mode: TemplateEditorMode;
  design: TemplateDesign | null;
  html_body: string | null;
  text_body: string | null;
  preheader: string | null;
  variables: string[];
}

/**
 * Resolve the stored representation for a create/update payload.
 *
 * - Non-email channels always use `simple` (email layout controls never apply
 *   to WhatsApp/SMS); any design payload is ignored, never stored.
 * - `visual`: the design doc is validated server-side, then deterministically
 *   rendered to `html_body` + `text_body`. The structured doc is preserved so
 *   reopening never depends on reverse-engineering HTML. `body` keeps the
 *   plain-text alternative so legacy consumers (sequence previews, logs) keep
 *   working.
 * - `html`: pasted/imported HTML is sanitized against the explicit allowlist;
 *   visual and HTML modes stay distinguishable (`editor_mode` + presence of
 *   `design`). Arbitrary HTML is never converted into editable blocks.
 * - `simple`: legacy behavior unchanged; html/design outputs are cleared only
 *   when explicitly switching away (mode switches never silently drop the
 *   other representation — callers pass through what they want to keep).
 */
export function prepareTemplateContent(input: {
  channel: string;
  editor_mode?: string;
  design?: unknown;
  body: string;
  subject?: string | null;
  preheader?: string | null;
}): PreparedTemplateContent {
  const requestedMode = (input.editor_mode ?? 'simple') as TemplateEditorMode;
  const editor_mode: TemplateEditorMode = input.channel === 'email' ? requestedMode : 'simple';
  const preheader = input.channel === 'email' ? (input.preheader ?? null) : null;

  if (editor_mode === 'visual') {
    const validated = validateDesign(input.design);
    if (!validated.ok) {
      throw new AppError(`Invalid design document: ${validated.errors.join('; ')}`, 422);
    }
    const design = validated.design;
    if (preheader && design.global.preheader !== preheader) {
      design.global.preheader = preheader;
    }
    const rendered = renderDesignToHtml(design);
    const unsafe = findUnsafeLinks(rendered.html);
    if (unsafe.length > 0) {
      throw new AppError(
        `Design contains unsafe link destinations: ${unsafe.slice(0, 3).join(', ')}`,
        422,
      );
    }
    const variables = Array.from(
      new Set([
        ...extractVariableNames(input.subject ?? ''),
        ...extractVariableNames(rendered.html),
        ...extractVariableNames(rendered.text),
      ]),
    );
    return {
      editor_mode,
      design,
      html_body: rendered.html,
      text_body: rendered.text,
      preheader: design.global.preheader || preheader,
      variables,
    };
  }

  if (editor_mode === 'html') {
    const { html } = sanitizeCustomHtml(input.body);
    if (!html.trim()) {
      throw new AppError('Custom HTML has no supported content after sanitization', 422);
    }
    const unsafe = findUnsafeLinks(html);
    if (unsafe.length > 0) {
      throw new AppError(
        `Custom HTML contains unsafe link destinations: ${unsafe.slice(0, 3).join(', ')}`,
        422,
      );
    }
    const text = emailHtmlToText(html);
    const variables = Array.from(
      new Set([
        ...extractVariableNames(input.subject ?? ''),
        ...extractVariableNames(html),
        ...extractVariableNames(preheader ?? ''),
      ]),
    );
    return { editor_mode, design: null, html_body: html, text_body: text, preheader, variables };
  }

  // Simple mode — legacy behavior. Variables come from subject + body.
  const variables = Array.from(
    new Set([...extractVariableNames(input.subject ?? ''), ...extractVariableNames(input.body)]),
  );
  return {
    editor_mode: 'simple',
    design: null,
    html_body: null,
    text_body: null,
    preheader,
    variables,
  };
}

/**
 * Resolve the send-time email payload for a template.
 * Re-exported from the design core for module consumers.
 */
export { resolveEmailPayload, leadToVariableValues };

export async function listTemplates(filters: TemplateListFilters): Promise<{
  items: TemplateResponse[];
  meta: { nextCursor?: string; hasMore: boolean };
}> {
  const limit = clampLimit(filters.limit);
  const { rows, hasMore } = await findTemplates({ ...filters, limit });

  const items = rows.map((r) => toResponse(r));
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ ts: last.created_at, id: last.id }) : undefined;

  return { items, meta: { nextCursor, hasMore } };
}

export async function getTemplate(id: string): Promise<TemplateResponse> {
  const row = await findTemplateById(id);
  if (!row) throw new AppError('Template not found', 404);
  return toResponse(row);
}

/**
 * Roles that may call POST /templates/:id/approve. An actor holding this role gains
 * nothing by being made to approve their own template as a second step, so we skip it.
 * Other creators (e.g. `manager` via the agent action) still land in 'pending'.
 */
const SELF_APPROVING_ROLES = new Set(['admin', 'marketing']);

/**
 * Approved templates are locked down so copy that has been signed off cannot drift.
 * Admins may always edit; so may the original author, since templates now land approved
 * on create and otherwise their author could never correct their own typo.
 */
function assertMayEditApproved(before: TemplateRow, actor: TemplateActor): void {
  if (before.approval_status !== 'approved') return;
  if (actor.role === 'admin') return;
  if (before.created_by === actor.id) return;
  throw new AppError(
    "Approved templates may only be edited by admin or the template's author",
    403,
  );
}

export async function createTemplate(
  input: TemplateInput,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const autoApprove = SELF_APPROVING_ROLES.has(actor.role);

  const prepared = prepareTemplateContent({
    channel: input.channel,
    editor_mode: input.editor_mode,
    design: input.design,
    body: input.body,
    subject: input.subject,
    preheader: input.preheader,
  });

  // Channel-specific guards (non-blocking warnings stay in preview; hard
  // failures here only for provider-impossible content).
  if (input.channel === 'whatsapp') {
    const check = validateWhatsappBody(input.body, 0);
    if (!check.ok) throw new AppError(check.errors.join('; '), 422);
  }

  const row = await insertTemplate({
    name: input.name,
    channel: input.channel,
    subject: input.subject ?? null,
    body: input.body,
    variables: input.variables ?? prepared.variables,
    created_by: actor.id,
    approved_by: autoApprove ? actor.id : null,
    editor_mode: prepared.editor_mode,
    design: prepared.design,
    html_body: prepared.html_body,
    text_body: prepared.text_body,
    preheader: prepared.preheader,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'template.created',
    entityType: 'template',
    entityId: row.id,
    newValue: {
      name: row.name,
      channel: row.channel,
      approval_status: row.approval_status,
    },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

export async function updateTemplate(
  id: string,
  input: Partial<TemplateInput>,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);

  assertMayEditApproved(before, actor);

  const nextChannel = input.channel ?? before.channel;
  const nextMode =
    input.editor_mode ?? (nextChannel !== before.channel ? 'simple' : before.editor_mode);
  const modeSwitching = input.editor_mode !== undefined && input.editor_mode !== before.editor_mode;
  const contentInputs =
    input.body !== undefined ||
    input.design !== undefined ||
    input.subject !== undefined ||
    input.preheader !== undefined ||
    input.channel !== undefined ||
    modeSwitching;

  let prepared: PreparedTemplateContent | null = null;
  if (contentInputs) {
    // Mode switches never silently drop the other representation: when the
    // caller switches mode without supplying new content, keep the stored
    // counterpart (body/design) so nothing is lost.
    const bodyForPrep =
      input.body !== undefined
        ? input.body
        : nextMode === 'html'
          ? (before.html_body ?? before.body)
          : nextMode === 'simple' && before.editor_mode !== 'simple'
            ? (before.text_body ?? before.body)
            : before.body;
    prepared = prepareTemplateContent({
      channel: nextChannel,
      editor_mode: nextMode,
      design: input.design !== undefined ? input.design : before.design,
      body: bodyForPrep,
      subject: input.subject !== undefined ? input.subject : before.subject,
      preheader: input.preheader !== undefined ? input.preheader : before.preheader,
    });
    if (nextChannel === 'whatsapp') {
      const check = validateWhatsappBody(bodyForPrep, (before.attachments ?? []).length);
      if (!check.ok) throw new AppError(check.errors.join('; '), 422);
    }
  }

  // Mode switches never silently discard stored representations: moving to
  // `simple` keeps any existing design/html_body in storage (delivery keys
  // off `editor_mode`, so stale output is never sent), and switching back
  // restores the editable structure.
  const keepStoredDesign = prepared !== null && prepared.editor_mode === 'simple';

  const row = await updateTemplateRepo(id, {
    name: input.name,
    channel: input.channel,
    subject: input.subject,
    body: input.body,
    variables: input.variables ?? prepared?.variables,
    ...(prepared && !keepStoredDesign
      ? {
          editor_mode: prepared.editor_mode,
          design: prepared.design,
          html_body: prepared.html_body,
          text_body: prepared.text_body,
          preheader: prepared.preheader,
        }
      : {}),
    ...(prepared && keepStoredDesign && (modeSwitching || input.channel !== undefined)
      ? { editor_mode: prepared.editor_mode, preheader: prepared.preheader }
      : {}),
  });

  // Reset to pending when meaningful content changes on an approved template,
  // so modified copy cannot go out without fresh approval.
  const renderedBefore = before.html_body ?? before.body;
  const renderedAfter = prepared
    ? (prepared.html_body ?? input.body ?? before.body)
    : (input.body ?? before.body);
  const contentChanged =
    (input.body !== undefined && input.body !== before.body) ||
    (input.subject !== undefined && (input.subject ?? null) !== before.subject) ||
    (prepared !== null &&
      (prepared.html_body !== before.html_body ||
        !isDeepStrictEqual(prepared.design ?? null, before.design ?? null) ||
        (prepared.preheader ?? null) !== (before.preheader ?? null) ||
        renderedAfter !== renderedBefore));
  if (contentChanged && before.approval_status === 'approved') {
    await setApprovalStatus(id, 'pending', null, null);
    row.approval_status = 'pending';
    row.approved_by = null;
    row.approved_at = null;
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'template.updated',
    entityType: 'template',
    entityId: id,
    oldValue: {
      name: before.name,
      channel: before.channel,
      approval_status: before.approval_status,
    },
    newValue: { name: row.name, channel: row.channel, approval_status: row.approval_status },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

export async function approveTemplate(
  id: string,
  input: TemplateApprovalInput,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);

  if (before.approval_status === 'approved' && input.approved) {
    throw new AppError('Template is already approved', 409);
  }
  if (before.approval_status === 'rejected' && !input.approved) {
    throw new AppError('Template is already rejected', 409);
  }

  const status = input.approved ? 'approved' : 'rejected';
  const row = await setApprovalStatus(
    id,
    status,
    input.approved ? actor.id : null,
    input.approved ? null : (input.rejection_reason ?? null),
  );

  await writeAuditLog({
    userId: actor.id,
    action: `template.${status}`,
    entityType: 'template',
    entityId: id,
    oldValue: { approval_status: before.approval_status },
    newValue: { approval_status: row.approval_status, rejection_reason: row.rejection_reason },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

export interface TemplatePreview {
  subject: string | null;
  html: string | null;
  text: string;
  variables: string[];
  invalidVariables: string[];
  unsafeLinks: string[];
  compliance: { errors: string[]; warnings: string[] };
  smsEstimate: SmsEstimate | null;
  whatsapp: { ok: boolean; errors: string[]; warnings: string[] } | null;
  /** Previews are approximations — not a guarantee of identical client rendering. */
  notice: string;
}

/**
 * Duplicate a template (same channel, mode, design, and attachments metadata).
 * The copy always starts in `pending` approval so duplicated copy gets fresh
 * sign-off; authors keep working without touching the original.
 */
export async function duplicateTemplate(
  id: string,
  name: string | undefined,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);

  const attachments: TemplateAttachment[] = [];
  const copiedPaths: string[] = [];
  let row: TemplateRow;
  try {
    for (const attachment of before.attachments ?? []) {
      if (attachment.libraryFileId) {
        attachments.push({ ...attachment, id: randomUUID() });
        continue;
      }
      const attachmentId = randomUUID();
      const diskFilename = `${attachmentId}${path.extname(attachment.storagePath)}`;
      const storagePath = path.join(UPLOAD_DIR, diskFilename);
      await mkdir(UPLOAD_DIR, { recursive: true });
      await copyFile(attachment.storagePath, storagePath);
      copiedPaths.push(storagePath);
      attachments.push({
        ...attachment,
        id: attachmentId,
        storagePath,
        url: `${publicBaseUrl()}/uploads/templates/${diskFilename}`,
      });
    }
    row = await insertTemplate({
      name: name?.trim() || `${before.name} (copy)`,
      channel: before.channel,
      subject: before.subject,
      body: before.body,
      variables: before.variables,
      created_by: actor.id,
      approved_by: null,
      editor_mode: before.editor_mode,
      design: (before.design as TemplateDesign | null) ?? null,
      html_body: before.html_body,
      text_body: before.text_body,
      preheader: before.preheader,
      attachments,
    });
  } catch (error) {
    await Promise.all(
      copiedPaths.map((storagePath) =>
        unlink(storagePath).catch((cleanupError: unknown) => {
          logger.error('failed to clean up duplicated attachment', {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }),
      ),
    );
    throw error;
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'template.duplicated',
    entityType: 'template',
    entityId: row.id,
    oldValue: { source_template_id: id },
    newValue: { name: row.name, channel: row.channel },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

/** Archive (soft-hide) or unarchive a template. Archived templates stay readable but are hidden from pickers. */
export async function setTemplateArchived(
  id: string,
  archived: boolean,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);
  assertMayEditApproved(before, actor);

  const row = await updateTemplateRepo(id, {
    archived_at: archived ? new Date().toISOString() : null,
  });

  await writeAuditLog({
    userId: actor.id,
    action: archived ? 'template.archived' : 'template.unarchived',
    entityType: 'template',
    entityId: id,
    oldValue: { archived_at: before.archived_at },
    newValue: { archived_at: row.archived_at },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

/**
 * Render a personalized preview with fictional sample values (never real lead
 * PII). Pure read — no side effects, no delivery, no automation triggered.
 */
export async function previewTemplate(
  id: string,
  sampleValues?: Record<string, string>,
): Promise<TemplatePreview> {
  const template = await findTemplateById(id);
  if (!template) throw new AppError('Template not found', 404);

  const values = previewValues(sampleValues);
  const subject = template.subject
    ? substituteVariables(template.subject, values, false)
    : template.subject;

  let html: string | null = null;
  let text: string;
  if (template.editor_mode !== 'simple' && template.html_body) {
    html = substituteVariables(template.html_body, values, true);
    text = substituteVariables(
      template.text_body ?? emailHtmlToText(template.html_body),
      values,
      false,
    );
  } else {
    text = substituteVariables(template.body, values, false);
  }

  // Invalid variables are detected from the raw (pre-substitution) sources so
  // unknown placeholders are reported instead of silently vanishing.
  const rawSources = [
    template.subject ?? '',
    template.preheader ?? '',
    template.html_body ?? '',
    template.text_body ?? '',
    template.body,
  ];
  const invalidVariables = Array.from(new Set(rawSources.flatMap(findInvalidVariables)));
  const unsafeLinks = html ? findUnsafeLinks(html) : [];
  const compliance =
    template.channel === 'email'
      ? checkEmailCompliance(`${html ?? ''}\n${text}`)
      : { errors: [], warnings: [] };

  return {
    subject,
    html,
    text,
    variables: template.variables,
    invalidVariables,
    unsafeLinks,
    compliance,
    smsEstimate: template.channel === 'sms' ? estimateSmsSegments(text) : null,
    whatsapp:
      template.channel === 'whatsapp'
        ? validateWhatsappBody(text, (template.attachments ?? []).length)
        : null,
    notice:
      'Preview uses fictional sample values and approximates rendering — email clients may display the message differently.',
  };
}

export interface TestSendResult {
  sent: boolean;
  to: string;
  channel: string;
  externalId?: string;
  latencyMs: number;
  warnings: string[];
}

/**
 * Send a one-off test email to a user-authorized recipient.
 *
 * Isolation guarantees: no outreach_logs row, no campaign enrollment, no
 * pipeline/tag changes, no tracking pixel or click rewriting, and the
 * template's approval state is untouched. Only email-channel templates are
 * supported; delivery reuses the authorized SendGrid → SMTP fallback chain.
 */
export async function testSendTemplate(
  id: string,
  to: string,
  sampleValues: Record<string, string> | undefined,
  actor: TemplateActor,
): Promise<TestSendResult> {
  const template = await findTemplateById(id);
  if (!template) throw new AppError('Template not found', 404);
  if (template.archived_at) throw new AppError('Archived templates cannot be test-sent', 400);
  if (template.channel !== 'email') {
    throw new AppError('Test send is only supported for email templates', 400);
  }

  const values = previewValues(sampleValues);
  const payload = resolveEmailPayload(template, values);
  // Unresolved variables are detected from raw sources (pre-substitution) so
  // unknown placeholders block delivery instead of going out as blank text.
  const rawSources = [
    template.subject ?? '',
    template.preheader ?? '',
    template.html_body ?? '',
    template.text_body ?? '',
    template.body,
  ];
  const invalidVariables = Array.from(new Set(rawSources.flatMap(findInvalidVariables)));
  if (invalidVariables.length > 0) {
    throw new AppError(
      `Unresolved variables: ${invalidVariables.map((v) => `{{${v}}}`).join(', ')} — fix or remove them before test send`,
      422,
    );
  }
  const unsafeLinks = findUnsafeLinks(payload.html);
  if (unsafeLinks.length > 0) {
    throw new AppError(`Unsafe link destinations: ${unsafeLinks.slice(0, 3).join(', ')}`, 422);
  }

  const { compliance } = { compliance: checkEmailCompliance(`${payload.html}\n${payload.text}`) };

  // Reuse the authorized delivery chain (SendGrid → SMTP fallback), mirroring
  // the newsletter system-email path, but without any subscriber/campaign I/O.
  const startedAt = Date.now();
  const emailInput = {
    leadId: `template-test:${id}`,
    campaignId: null,
    to,
    subject: `[Test] ${payload.subject ?? template.name}`,
    htmlBody: payload.html,
    textBody: payload.text,
    attachments: (template.attachments ?? []).map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      storagePath: a.storagePath,
    })),
  };

  let outcome: { ok: boolean; externalId?: string; latencyMs: number; error?: string };
  try {
    const sendgrid = await import('../integrations/sendgrid/sendgrid.connector');
    const res = await sendgrid.sendEmail(emailInput);
    outcome = res.ok
      ? { ok: true, externalId: res.externalId, latencyMs: res.latencyMs }
      : { ok: false, error: res.error, latencyMs: res.latencyMs };
  } catch (err) {
    outcome = {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown error',
      latencyMs: Date.now() - startedAt,
    };
  }
  if (!outcome.ok) {
    const msg = outcome.error ?? '';
    const notConfigured =
      msg.toLowerCase().includes('not configured') ||
      msg.toLowerCase().includes('credentials not set');
    if (notConfigured) {
      const smtp = await import('../integrations/smtp/smtp.connector');
      try {
        const res = await smtp.sendEmail(emailInput);
        outcome = res.ok
          ? { ok: true, externalId: res.externalId, latencyMs: res.latencyMs }
          : { ok: false, error: res.error, latencyMs: res.latencyMs };
      } catch (err) {
        outcome = {
          ok: false,
          error: err instanceof Error ? err.message : 'unknown error',
          latencyMs: Date.now() - startedAt,
        };
      }
    }
  }

  if (!outcome.ok) {
    logger.error('template test send failed', {
      template_id: id,
      error: outcome.error,
    });
    throw new AppError(`Test send failed: ${outcome.error ?? 'unknown error'}`, 502);
  }

  logger.info('template test send dispatched', {
    template_id: id,
    channel: template.channel,
    latency_ms: outcome.latencyMs,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'template.test_sent',
    entityType: 'template',
    entityId: id,
    newValue: { channel: template.channel },
    ipAddress: actor.ipAddress ?? null,
  });

  return {
    sent: true,
    to,
    channel: template.channel,
    externalId: outcome.externalId,
    latencyMs: outcome.latencyMs,
    warnings: compliance.warnings,
  };
}

export async function removeTemplate(id: string, actor: TemplateActor): Promise<void> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);

  await deleteTemplate(id);

  await Promise.all(
    (before.attachments ?? [])
      // Library-referenced attachments don't own their disk file — never unlink those.
      .filter((a) => !a.libraryFileId)
      .map((a) =>
        unlink(a.storagePath).catch((err) =>
          logger.warn('failed to delete template attachment file', {
            templateId: id,
            attachmentId: a.id,
            error: (err as Error).message,
          }),
        ),
      ),
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'template.deleted',
    entityType: 'template',
    entityId: id,
    oldValue: { name: before.name, channel: before.channel },
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function addTemplateAttachment(
  id: string,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);

  assertMayEditApproved(before, actor);
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new AppError(
      `Unsupported file type "${file.mimetype}". Allowed: PNG, JPEG, WEBP, GIF, PDF.`,
      400,
    );
  }
  if ((before.attachments ?? []).length >= MAX_ATTACHMENTS_PER_TEMPLATE) {
    throw new AppError(
      `A template may have at most ${MAX_ATTACHMENTS_PER_TEMPLATE} attachments`,
      400,
    );
  }

  const ext = (path.extname(file.originalname) || '').toLowerCase();
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME[file.mimetype] ?? [];
  if (!allowedExtensions.includes(ext)) {
    throw new AppError(
      `File extension "${ext}" does not match declared type "${file.mimetype}".`,
      400,
    );
  }

  const attachmentId = randomUUID();
  const diskFilename = `${attachmentId}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storagePath = path.join(UPLOAD_DIR, diskFilename);
  await writeFile(storagePath, file.buffer);

  const attachment: TemplateAttachment = {
    id: attachmentId,
    filename: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    url: `${publicBaseUrl()}/uploads/templates/${diskFilename}`,
    storagePath,
  };

  const row = await appendTemplateAttachment(id, attachment);

  await writeAuditLog({
    userId: actor.id,
    action: 'template.attachment_added',
    entityType: 'template',
    entityId: id,
    newValue: { filename: attachment.filename, mimeType: attachment.mimeType },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

/** Attach a shared Files-library entry to a template by reference (no re-upload). */
export async function addTemplateAttachmentFromLibrary(
  id: string,
  fileId: string,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);

  assertMayEditApproved(before, actor);
  if ((before.attachments ?? []).length >= MAX_ATTACHMENTS_PER_TEMPLATE) {
    throw new AppError(
      `A template may have at most ${MAX_ATTACHMENTS_PER_TEMPLATE} attachments`,
      400,
    );
  }

  const libraryFile = await getFileRow(fileId);

  const attachment: TemplateAttachment = {
    id: randomUUID(),
    filename: libraryFile.filename,
    mimeType: libraryFile.mime_type,
    sizeBytes: libraryFile.size_bytes,
    url: libraryFile.url,
    storagePath: libraryFile.storage_path,
    libraryFileId: libraryFile.id,
  };

  const row = await appendTemplateAttachment(id, attachment);

  await writeAuditLog({
    userId: actor.id,
    action: 'template.attachment_added_from_library',
    entityType: 'template',
    entityId: id,
    newValue: { filename: attachment.filename, libraryFileId: libraryFile.id },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}

export async function removeTemplateAttachment(
  id: string,
  attachmentId: string,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const before = await findTemplateById(id);
  if (!before) throw new AppError('Template not found', 404);

  assertMayEditApproved(before, actor);

  const existing = (before.attachments ?? []).find((a) => a.id === attachmentId);
  if (!existing) throw new AppError('Attachment not found', 404);

  const row = await removeTemplateAttachmentRepo(id, attachmentId);

  // Library-referenced attachments don't own their disk file — never unlink those.
  if (!existing.libraryFileId) {
    await unlink(existing.storagePath).catch((err) =>
      logger.warn('failed to delete template attachment file', {
        templateId: id,
        attachmentId,
        error: (err as Error).message,
      }),
    );
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'template.attachment_removed',
    entityType: 'template',
    entityId: id,
    oldValue: { filename: existing.filename },
    ipAddress: actor.ipAddress ?? null,
  });

  return toResponse(row);
}
