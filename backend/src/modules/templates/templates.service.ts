import { randomUUID } from 'crypto';
import { unlink, writeFile, mkdir } from 'fs/promises';
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
  TemplateInput,
  TemplateListFilters,
  TemplateResponse,
} from './templates.types';
import { getFileRow } from '../files/files.service';

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
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

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

export async function createTemplate(
  input: TemplateInput,
  actor: TemplateActor,
): Promise<TemplateResponse> {
  const row = await insertTemplate({
    name: input.name,
    channel: input.channel,
    subject: input.subject ?? null,
    body: input.body,
    variables: input.variables ?? [],
    created_by: actor.id,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'template.created',
    entityType: 'template',
    entityId: row.id,
    newValue: { name: row.name, channel: row.channel },
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

  // Once approved, only admin may edit. Marketing can edit their own pending/draft templates.
  if (before.approval_status === 'approved' && actor.role !== 'admin') {
    throw new AppError('Approved templates may only be edited by admin', 403);
  }

  const row = await updateTemplateRepo(id, {
    name: input.name,
    channel: input.channel,
    subject: input.subject,
    body: input.body,
    variables: input.variables,
  });

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

  if (before.approval_status === 'approved' && actor.role !== 'admin') {
    throw new AppError('Approved templates may only be edited by admin', 403);
  }
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

  const attachmentId = randomUUID();
  const ext = path.extname(file.originalname) || '';
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

  if (before.approval_status === 'approved' && actor.role !== 'admin') {
    throw new AppError('Approved templates may only be edited by admin', 403);
  }
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

  if (before.approval_status === 'approved' && actor.role !== 'admin') {
    throw new AppError('Approved templates may only be edited by admin', 403);
  }

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
