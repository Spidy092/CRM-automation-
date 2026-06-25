import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { clampLimit, encodeCursor } from '../../shared/utils/pagination';
import {
  deleteTemplate,
  findTemplateById,
  findTemplates,
  insertTemplate,
  setApprovalStatus,
  updateTemplate as updateTemplateRepo,
} from './templates.repository';
import {
  TemplateActor,
  TemplateApprovalInput,
  TemplateInput,
  TemplateListFilters,
  TemplateResponse,
} from './templates.types';

function toResponse(row: {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
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

  await writeAuditLog({
    userId: actor.id,
    action: 'template.deleted',
    entityType: 'template',
    entityId: id,
    oldValue: { name: before.name, channel: before.channel },
    ipAddress: actor.ipAddress ?? null,
  });
}
