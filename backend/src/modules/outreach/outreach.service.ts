import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { clampLimit } from '../../shared/utils/pagination';
import {
  OutreachActor,
  OutreachLogInput,
  OutreachLogRow,
  SequenceEnrollmentStats,
  SequenceInput,
  SequenceRow,
  TaskInput,
  TaskRow,
  TimelineEntry,
} from './outreach.types';
import { MessageChannel, OutreachStatus } from '../../shared/types';
import {
  deleteSequence,
  findLogsByLead,
  findSequenceById,
  findSequences,
  findTaskById,
  findTasks,
  findTimelineByLead,
  getSequenceEnrollmentStats,
  insertOutreachLog,
  insertSequence,
  insertTask,
  updateOutreachLogStatus,
  updateSequence as updateSequenceRepo,
  updateTask as updateTaskRepo,
} from './outreach.repository';
import { enqueueOutreachDispatch, enqueueOutreachFollowUp } from '../../workers/queue';
import { findLeadById } from '../leads/leads.repository';
import { findTemplateById } from '../templates/templates.repository';
import { personalizeMessage } from './outreach.prompt';
import { dispatchOutbound } from '../integrations/dispatch';

function toSequenceResponse(row: SequenceRow) {
  return { ...row };
}

export async function listSequences(
  limit?: number,
  offset?: number,
): Promise<{
  items: SequenceRow[];
  meta: { limit: number; offset: number; totalHint?: number };
}> {
  const safeLimit = clampLimit(limit);
  const safeOffset = Math.max(0, offset ?? 0);
  const items = await findSequences(safeLimit, safeOffset);
  return { items: items.map(toSequenceResponse), meta: { limit: safeLimit, offset: safeOffset } };
}

export async function getSequence(id: string): Promise<SequenceRow> {
  const row = await findSequenceById(id);
  if (!row) throw new AppError('Sequence not found', 404);
  return toSequenceResponse(row);
}

export async function createSequence(
  input: SequenceInput,
  actor: OutreachActor,
): Promise<SequenceRow> {
  const row = await insertSequence({
    name: input.name,
    description: input.description ?? null,
    is_active: input.is_active ?? true,
    steps: input.steps,
    created_by: actor.id,
  });
  await writeAuditLog({
    userId: actor.id,
    action: 'sequence.created',
    entityType: 'sequence',
    entityId: row.id,
    newValue: { name: row.name },
    ipAddress: actor.ipAddress ?? null,
  });
  return toSequenceResponse(row);
}

export async function updateSequence(
  id: string,
  input: Partial<SequenceInput>,
  actor: OutreachActor,
): Promise<SequenceRow> {
  const before = await findSequenceById(id);
  if (!before) throw new AppError('Sequence not found', 404);

  const row = await updateSequenceRepo(id, {
    name: input.name,
    ...('description' in input ? { description: input.description ?? null } : {}),
    ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    steps: input.steps,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'sequence.updated',
    entityType: 'sequence',
    entityId: id,
    oldValue: { name: before.name, steps: before.steps, is_active: before.is_active },
    newValue: { name: row.name, steps: row.steps, is_active: row.is_active },
    ipAddress: actor.ipAddress ?? null,
  });

  return toSequenceResponse(row);
}

export async function getSequenceStats(id: string): Promise<SequenceEnrollmentStats> {
  const seq = await findSequenceById(id);
  if (!seq) throw new AppError('Sequence not found', 404);
  return getSequenceEnrollmentStats(id);
}

export async function removeSequence(id: string, actor: OutreachActor): Promise<void> {
  const before = await findSequenceById(id);
  if (!before) throw new AppError('Sequence not found', 404);
  await deleteSequence(id);
  await writeAuditLog({
    userId: actor.id,
    action: 'sequence.deleted',
    entityType: 'sequence',
    entityId: id,
    oldValue: { name: before.name },
    ipAddress: actor.ipAddress ?? null,
  });
}

// ── Outreach Logs ──────────────────────────────────────────────────────────

function toLogResponse(row: OutreachLogRow) {
  return { ...row };
}

export async function createLog(data: OutreachLogInput): Promise<OutreachLogRow> {
  const row = await insertOutreachLog({
    lead_id: data.leadId,
    campaign_id: data.campaignId ?? null,
    channel: data.channel,
    template_id: data.templateId ?? null,
    step_number: data.stepNumber ?? null,
    status: data.status ?? 'queued',
    message_body: data.messageBody ?? null,
  });
  return toLogResponse(row);
}

export async function updateLogStatus(
  id: string,
  status: OutreachStatus,
  extra?: Partial<{
    sentAt: string;
    deliveredAt: string;
    openedAt: string;
    repliedAt: string;
    errorMessage: string;
    externalMsgId: string;
  }>,
): Promise<OutreachLogRow> {
  const row = await updateOutreachLogStatus(id, status, extra);
  return toLogResponse(row);
}

export async function getLeadLogs(leadId: string, limit?: number): Promise<OutreachLogRow[]> {
  const safeLimit = clampLimit(limit);
  const rows = await findLogsByLead(leadId, safeLimit);
  return rows.map(toLogResponse);
}

// ── Tasks ──────────────────────────────────────────────────────────────────

function toTaskResponse(row: TaskRow) {
  return { ...row };
}

export async function getTask(id: string): Promise<TaskRow> {
  const row = await findTaskById(id);
  if (!row) throw new AppError('Task not found', 404);
  return toTaskResponse(row);
}

export async function listTasks(
  filters: { status?: string; assignedTo?: 'me'; limit?: number },
  actor: OutreachActor,
): Promise<TaskRow[]> {
  const rows = await findTasks({
    status: filters.status,
    assignedTo: filters.assignedTo === 'me' ? actor.id : undefined,
    limit: clampLimit(filters.limit),
  });
  return rows.map(toTaskResponse);
}

export async function createTask(input: TaskInput, actor: OutreachActor): Promise<TaskRow> {
  const row = await insertTask({
    lead_id: input.leadId,
    campaign_id: input.campaignId ?? null,
    sequence_id: input.sequenceId ?? null,
    step_number: input.stepNumber ?? null,
    assigned_to: input.assignedTo ?? null,
    type: input.type,
    title: input.title,
    description: input.description ?? null,
    due_at: input.dueAt ?? null,
    created_by: actor.id,
  });
  await writeAuditLog({
    userId: actor.id,
    action: 'task.created',
    entityType: 'task',
    entityId: row.id,
    newValue: { title: row.title, type: row.type },
    ipAddress: actor.ipAddress ?? null,
  });
  return toTaskResponse(row);
}

export async function updateTask(
  id: string,
  fields: Partial<{
    assignedTo: string | null;
    status: string;
    dueAt: string | null;
    title: string;
    description: string | null;
  }>,
  actor: OutreachActor,
): Promise<TaskRow> {
  const before = await findTaskById(id);
  if (!before) throw new AppError('Task not found', 404);

  const row = await updateTaskRepo(id, {
    assigned_to: fields.assignedTo,
    status: fields.status,
    due_at: fields.dueAt,
    title: fields.title,
    description: fields.description,
    completed_at: fields.status === 'completed' ? new Date().toISOString() : undefined,
  });
  if (before.type === 'phone_call' && before.status !== 'completed' && row.status === 'completed') {
    await enqueueNextStepAfterTask(row);
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'task.updated',
    entityType: 'task',
    entityId: id,
    oldValue: { status: before.status, assigned_to: before.assigned_to },
    newValue: { status: row.status, assigned_to: row.assigned_to },
    ipAddress: actor.ipAddress ?? null,
  });

  return toTaskResponse(row);
}

// ── Timeline ───────────────────────────────────────────────────────────────

async function enqueueNextStepAfterTask(task: TaskRow): Promise<void> {
  if (!task.campaign_id || !task.sequence_id || task.step_number === null) return;

  const sequence = await findSequenceById(task.sequence_id);
  if (!sequence) return;

  const nextStep = sequence.steps.find((step) => step.stepNumber === (task.step_number ?? 0) + 1);
  if (!nextStep) return;

  await enqueueOutreachFollowUp({
    leadId: task.lead_id,
    campaignId: task.campaign_id,
    sequenceId: task.sequence_id,
    previousStepNumber: task.step_number,
    nextStepNumber: nextStep.stepNumber,
    delayHours: nextStep.delayHours ?? 24,
    mockMode: false,
  });
}

function destinationForChannel(
  lead: { email: string; phone: string },
  channel: MessageChannel,
): string {
  if (channel === 'email') return lead.email;
  return lead.phone;
}

export async function sendManualOutreach(
  input: {
    leadId: string;
    campaignId: string;
    sequenceId: string;
    stepNumber: number;
    channel: MessageChannel;
    templateId: string;
    mockMode?: boolean;
  },
  actor: OutreachActor,
): Promise<{ enqueued: boolean }> {
  const lead = await findLeadById(input.leadId);
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.status === 'opted_out') {
    throw new AppError('Lead has opted out of outreach', 400);
  }
  if (lead.status !== 'active') throw new AppError('Lead is not active', 400);

  const template = await findTemplateById(input.templateId);
  if (!template) throw new AppError('Template not found', 404);
  if (template.approval_status !== 'approved') throw new AppError('Template is not approved', 400);
  if (template.channel !== input.channel) throw new AppError('Template channel mismatch', 400);

  const destination = destinationForChannel(lead, input.channel);
  if (!destination) throw new AppError('Lead has no destination for this channel', 400);

  await enqueueOutreachDispatch({
    leadId: input.leadId,
    campaignId: input.campaignId,
    sequenceId: input.sequenceId,
    stepNumber: input.stepNumber,
    channel: input.channel,
    templateId: input.templateId,
    mockMode: input.mockMode ?? false,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'outreach.manual_send_enqueued',
    entityType: 'lead',
    entityId: input.leadId,
    newValue: {
      campaignId: input.campaignId,
      channel: input.channel,
      templateId: input.templateId,
    },
    ipAddress: actor.ipAddress ?? null,
  });

  return { enqueued: true };
}

/**
 * Ad-hoc single-lead send fired from the lead detail page ("Quick Response").
 * Unlike `sendManualOutreach`, this is synchronous (no BullMQ hop) and carries
 * no campaign/sequence context — the outreach_logs row it writes has a null
 * campaign_id, matching a manual, one-off touch rather than a sequence step.
 */
export async function sendQuickMessage(
  leadId: string,
  input: { channel: MessageChannel; templateId: string },
  actor: OutreachActor,
): Promise<OutreachLogRow> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.status === 'opted_out') {
    throw new AppError('Lead has opted out — cannot send a message', 400);
  }

  const template = await findTemplateById(input.templateId);
  if (!template) throw new AppError('Template not found', 404);
  if (template.approval_status !== 'approved') throw new AppError('Template is not approved', 400);
  if (template.channel !== input.channel) throw new AppError('Template channel mismatch', 400);

  const destination = destinationForChannel(lead, input.channel);
  if (!destination) throw new AppError('Lead has no destination for this channel', 400);

  // AI personalization is skipped here (enabled: false) so the send stays
  // synchronous and the rep sees the exact rendered text before it goes out.
  const { message } = await personalizeMessage(lead, template, { enabled: false });

  const log = await createLog({
    leadId,
    campaignId: null,
    channel: input.channel,
    templateId: input.templateId,
    stepNumber: null,
    status: 'queued',
    messageBody: message,
  });

  const outcome = await dispatchOutbound({
    leadId,
    campaignId: null,
    channel: input.channel,
    templateId: input.templateId,
    body: message,
    destination,
    subject: template.subject ?? undefined,
    mockMode: false,
    logId: log.id,
    attachments: template.attachments,
  });

  if (!outcome.ok) {
    await updateLogStatus(log.id, 'failed' as OutreachStatus, {
      errorMessage: outcome.error ?? 'Unknown dispatch error',
    });
    throw new AppError(
      `Quick send failed via ${input.channel}: ${outcome.error ?? 'unknown error'}`,
      502,
    );
  }

  const sentLog = await updateLogStatus(log.id, 'sent' as OutreachStatus, {
    externalMsgId: outcome.externalId,
    sentAt: new Date().toISOString(),
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'outreach.quick_send',
    entityType: 'lead',
    entityId: leadId,
    newValue: { channel: input.channel, templateId: input.templateId },
    ipAddress: actor.ipAddress ?? null,
  });

  return sentLog;
}

export async function getLeadTimeline(leadId: string, limit?: number): Promise<TimelineEntry[]> {
  const safeLimit = clampLimit(limit);
  return findTimelineByLead(leadId, safeLimit);
}
