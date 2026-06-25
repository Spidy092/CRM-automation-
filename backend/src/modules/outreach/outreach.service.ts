import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { clampLimit } from '../../shared/utils/pagination';
import {
  OutreachActor,
  OutreachLogInput,
  OutreachLogRow,
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
    steps: input.steps,
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'sequence.updated',
    entityType: 'sequence',
    entityId: id,
    oldValue: { name: before.name, steps: before.steps },
    newValue: { name: row.name, steps: row.steps },
    ipAddress: actor.ipAddress ?? null,
  });

  return toSequenceResponse(row);
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

function destinationForChannel(lead: { email: string; phone: string }, channel: MessageChannel): string {
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
    newValue: { campaignId: input.campaignId, channel: input.channel, templateId: input.templateId },
    ipAddress: actor.ipAddress ?? null,
  });

  return { enqueued: true };
}

export async function getLeadTimeline(leadId: string, limit?: number): Promise<TimelineEntry[]> {
  const safeLimit = clampLimit(limit);
  return findTimelineByLead(leadId, safeLimit);
}
