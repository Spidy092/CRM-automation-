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
import type { QuickSendInput } from './outreach.schema';
import { MessageChannel, OutreachStatus, TaskType } from '../../shared/types';
import {
  deleteSequence,
  findLogsByLead,
  findSequenceById,
  findSequenceByIdIncludingDeleted,
  findSequences,
  findOpenSystemTaskByLead,
  findTaskAssigneeForLead,
  findTaskById,
  findTasks,
  findTasksVisibleToUser,
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
import {
  assertAccess,
  getLeadById as getLeadByIdService,
  getLeadIdsOwnedBy,
} from '../leads/leads.service';
import { findTemplateById } from '../templates/templates.repository';
import { personalizeMessage } from './outreach.prompt';
import {
  leadToVariableValues,
  resolveEmailPayload,
  substituteVariables,
  ensureRecipientUnsubscribeLink,
} from '../templates/templateDesign';
import { dispatchOutbound } from '../integrations/dispatch';
import { createOutreachUnsubscribeUrl } from './unsubscribe.service';

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

/**
 * Actor id reserved for worker-originated task writes (outreach worker
 * phone-call tasks). HTTP actors always carry database UUIDs from verified
 * JWTs, so this sentinel can never arrive from a client and is safe to
 * trust as internal-only.
 */
const SYSTEM_ACTOR_ID = 'system';

function isSystemActor(actor: OutreachActor): boolean {
  return actor.id === SYSTEM_ACTOR_ID;
}

function isPrivileged(actor: OutreachActor): boolean {
  return actor.role === 'admin' || actor.role === 'manager';
}

/**
 * Adapts an outreach actor to the leads-module Actor shape. Roles arrive
 * from verified JWTs via route-level `authorize(...)`, so the cast is a
 * type-level bridge, not a trust boundary.
 */
function toLeadActor(actor: OutreachActor): {
  id: string;
  role: 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer';
  ipAddress?: string | null;
} {
  return {
    id: actor.id,
    role: actor.role as 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer',
    ipAddress: actor.ipAddress ?? null,
  };
}

function toTaskResponse(row: TaskRow) {
  return { ...row };
}

/**
 * Loads a task and enforces read access: task assignee, task creator, lead
 * owner, or admin/manager. An assignee can always read their own task —
 * the minimum visibility needed to perform delegated work — even without
 * access to the parent lead (whose detail endpoints stay gated).
 */
async function loadTaskForRead(id: string, actor: OutreachActor): Promise<TaskRow> {
  const task = await findTaskById(id);
  if (!task) throw new AppError('Task not found', 404);
  if (
    isSystemActor(actor) ||
    isPrivileged(actor) ||
    task.assigned_to === actor.id ||
    task.created_by === actor.id
  ) {
    return task;
  }
  try {
    await getLeadByIdService(task.lead_id, toLeadActor(actor));
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 403) {
      throw new AppError('Task not found', 404);
    }
    throw error;
  }
  return task;
}

export async function getTask(id: string, actor: OutreachActor): Promise<TaskRow> {
  const task = await loadTaskForRead(id, actor);
  return toTaskResponse(task);
}

export async function listTasks(
  filters: { status?: string; assignedTo?: 'me'; limit?: number },
  actor: OutreachActor,
): Promise<TaskRow[]> {
  if (isSystemActor(actor) || isPrivileged(actor)) {
    const rows = await findTasks({
      status: filters.status,
      assignedTo: filters.assignedTo === 'me' ? actor.id : undefined,
      limit: clampLimit(filters.limit),
    });
    return rows.map(toTaskResponse);
  }
  // Non-privileged actors see only tasks assigned to them, created by them,
  // or on leads they own — enforced in the query, not just the service.
  const rows = await findTasksVisibleToUser({
    userId: actor.id,
    ownedLeadIds: await getLeadIdsOwnedBy(actor.id),
    status: filters.status,
    assignedTo: filters.assignedTo === 'me' ? actor.id : undefined,
    limit: clampLimit(filters.limit),
  });
  return rows.map(toTaskResponse);
}

export async function createTask(input: TaskInput, actor: OutreachActor): Promise<TaskRow> {
  if (!isSystemActor(actor)) {
    // The creator needs write access to the parent lead. Delegating the
    // task to someone else additionally requires the reassign right
    // (lead owner or admin/manager) — see updateTask below.
    const lead = await getLeadByIdService(input.leadId, toLeadActor(actor));
    assertAccess(lead.assigned_to, toLeadActor(actor), true);
    if (
      input.assignedTo != null &&
      input.assignedTo !== actor.id &&
      !isPrivileged(actor) &&
      lead.assigned_to !== actor.id
    ) {
      throw new AppError('Forbidden: only the lead owner may delegate tasks to others', 403);
    }
  }
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
    // tasks.created_by references users; internal worker actors have no
    // user row and must be stored as NULL.
    created_by: isSystemActor(actor) ? null : actor.id,
  });
  await writeAuditLog({
    userId: isSystemActor(actor) ? null : actor.id,
    action: 'task.created',
    entityType: 'task',
    entityId: row.id,
    newValue: { title: row.title, type: row.type },
    ipAddress: actor.ipAddress ?? null,
  });
  return toTaskResponse(row);
}

export interface ReplyTaskUpsert {
  leadId: string;
  campaignId?: string | null;
  type: TaskType;
  title: string;
  description?: string | null;
  dueAt?: string | null;
}

/**
 * Creates — or updates in place — the single open system task for a lead's
 * inbound reply.
 *
 * Called twice per reply, by design:
 *   1. the webhook, immediately, with a generic placeholder so the rep sees
 *      something even if OpenAI is slow, down, or unconfigured;
 *   2. the AI classifier, once the intent is known, which sharpens the same
 *      task's title/type/due date rather than adding a second one.
 *
 * Dedup is keyed on "the lead's open task with `created_by IS NULL`", so a
 * lead who sends three messages in a row ends up with one current task, and a
 * rep's own manually-created tasks are never touched.
 *
 * The assignee is resolved here (rep → campaign owner → unassigned) so callers
 * cannot accidentally drop the task by passing a lead that has no rep.
 */
export async function upsertReplyTask(input: ReplyTaskUpsert): Promise<TaskRow> {
  const assignee = await findTaskAssigneeForLead(input.leadId);
  const existing = await findOpenSystemTaskByLead(input.leadId);

  if (existing) {
    const row = await updateTaskRepo(existing.id, {
      title: input.title,
      description: input.description ?? null,
      due_at: input.dueAt ?? null,
      type: input.type,
      // Re-assert the assignee: the lead may have been assigned to a rep
      // between the placeholder insert and classification finishing.
      assigned_to: assignee,
    });
    return toTaskResponse(row);
  }

  const row = await insertTask({
    lead_id: input.leadId,
    campaign_id: input.campaignId ?? null,
    sequence_id: null,
    step_number: null,
    assigned_to: assignee,
    type: input.type,
    title: input.title,
    description: input.description ?? null,
    due_at: input.dueAt ?? null,
    // NULL marks this as system-generated — the dedup key above depends on it.
    created_by: null,
  });
  return toTaskResponse(row);
}

/**
 * Cancels the lead's open system reply task, if one exists.
 *
 * Used on opt-out: the placeholder task the webhook created must not outlive
 * the classification that told us to stop contacting this lead. No-ops when
 * there is nothing open, and never touches rep-created tasks.
 */
export async function resolveOpenReplyTask(leadId: string): Promise<void> {
  const existing = await findOpenSystemTaskByLead(leadId);
  if (!existing) return;
  await updateTaskRepo(existing.id, { status: 'cancelled' });
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

  // Per-field authorization, evaluated exhaustively BEFORE any write: a
  // mixed-field request is rejected in full if any requested change is
  // unauthorized, so no partial mutation can slip through.
  if (!isSystemActor(actor) && !isPrivileged(actor)) {
    let leadOwnerId: string | null = null;
    try {
      const lead = await getLeadByIdService(before.lead_id, toLeadActor(actor));
      leadOwnerId = lead.assigned_to;
    } catch (error) {
      // A sales task assignee or creator may work on a delegated task without
      // access to the full parent lead. Treat only an access denial as
      // "not the owner"; propagate database and not-found failures.
      if (!(error instanceof AppError) || error.statusCode !== 403) throw error;
    }
    const isAssignee = before.assigned_to === actor.id;
    const isCreator = before.created_by === actor.id;
    const isLeadOwner = leadOwnerId === actor.id;

    if (fields.status !== undefined) {
      // Completing (or reopening/cancelling): assignee, lead owner, or privileged.
      if (!isAssignee && !isLeadOwner) {
        throw new AppError(
          'Forbidden: only the assignee or lead owner may change task status',
          403,
        );
      }
    }
    if (fields.assignedTo !== undefined) {
      // Reassigning: lead owner only. The assignee may only release the
      // task back (null), never name another user.
      const releasing = fields.assignedTo === null && isAssignee;
      if (!isLeadOwner && !releasing) {
        throw new AppError('Forbidden: only the lead owner may reassign tasks', 403);
      }
    }
    const editsContent = fields.title !== undefined || fields.description !== undefined;
    if (editsContent && !isCreator && !isLeadOwner) {
      // The assignee's completion permission does not grant editing: only
      // due-date replanning is theirs (covered by the dueAt branch below).
      throw new AppError('Forbidden: only the creator or lead owner may edit task content', 403);
    }
    if (fields.dueAt !== undefined && !isAssignee && !isCreator && !isLeadOwner) {
      throw new AppError('Forbidden: you cannot change this task', 403);
    }
    if (!isAssignee && !isCreator && !isLeadOwner) {
      throw new AppError('Forbidden: you cannot update this task', 403);
    }
  }

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
    userId: isSystemActor(actor) ? null : actor.id,
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

  const sequence = await findSequenceByIdIncludingDeleted(task.sequence_id);
  if (!sequence) return;

  // Durable enrollment ownership is persisted. Keep using it when the rollout
  // flag changes, and let errors propagate so a durable row can never fall
  // through to an untracked legacy send.
  const durable = await scheduleDurableAfterPhoneTask(task);
  if (durable) return;

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

/**
 * Phone-call completion on the durable path. Returns true when the
 * completion was handled durably (scheduled or known duplicate); false when
 * the caller should use the legacy follow-up instead.
 */
async function scheduleDurableAfterPhoneTask(task: TaskRow): Promise<boolean> {
  const { findCampaignById } = await import('../campaigns/campaigns.repository');
  const { scheduleAfterPhoneTask } = await import('../campaigns/campaigns.execution.service');
  if (!task.campaign_id || !task.sequence_id || task.step_number === null) return false;
  const campaign = await findCampaignById(task.campaign_id);
  if (!campaign) return false;
  const result = await scheduleAfterPhoneTask({
    campaign,
    leadId: task.lead_id,
    sequenceId: task.sequence_id,
    completedStepNumber: task.step_number,
    completedAt: new Date(),
  });
  return result.owned;
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
  input: QuickSendInput,
  actor: OutreachActor,
): Promise<OutreachLogRow> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);
  if (lead.status === 'opted_out') {
    throw new AppError('Lead has opted out — cannot send a message', 400);
  }

  let message: string;
  let dispatchBody: string;
  let unsubscribeUrl: string | undefined;
  let subject: string | undefined;
  let templateId: string | null = input.templateId ?? null;
  let attachments: NonNullable<Awaited<ReturnType<typeof findTemplateById>>>['attachments'] = [];

  if (input.templateId) {
    const template = await findTemplateById(input.templateId);
    if (!template) throw new AppError('Template not found', 404);
    if (template.approval_status !== 'approved')
      throw new AppError('Template is not approved', 400);
    if (template.channel !== input.channel) throw new AppError('Template channel mismatch', 400);

    // AI personalization is skipped here (enabled: false) so the send stays
    // synchronous and the rep sees the exact rendered text before it goes out.
    // Visual/custom-HTML email templates send their saved rendered HTML with
    // deterministic substitution; simple templates keep the legacy path.
    const values = leadToVariableValues(lead);
    if (input.channel === 'email' && template.editor_mode !== 'simple' && template.html_body) {
      unsubscribeUrl = await createOutreachUnsubscribeUrl(lead.id, lead.email);
      values.unsubscribe_link = unsubscribeUrl;
      const payload = resolveEmailPayload(template, values);
      message = payload.text;
      dispatchBody = payload.html;
      subject = payload.subject ?? template.subject ?? undefined;
    } else {
      const personalized = await personalizeMessage(lead, template, { enabled: false });
      message = personalized.message;
      dispatchBody = message;
      subject = template.subject ? substituteVariables(template.subject, values, false) : undefined;
    }
    attachments = template.attachments;
  } else {
    if (!input.body) throw new AppError('Message body is required', 400);
    if (input.channel === 'email' && !input.subject) {
      throw new AppError('Email subject is required for custom messages', 400);
    }

    message = input.body;
    subject = input.channel === 'email' ? input.subject : undefined;
    dispatchBody = input.channel === 'email' ? customEmailBodyToHtml(message) : message;
    templateId = null;
  }

  const destination = destinationForChannel(lead, input.channel);
  if (!destination) throw new AppError('Lead has no destination for this channel', 400);

  if (input.channel === 'email') {
    unsubscribeUrl ??= await createOutreachUnsubscribeUrl(lead.id, lead.email);
    dispatchBody = ensureRecipientUnsubscribeLink(dispatchBody, unsubscribeUrl);
  }

  const log = await createLog({
    leadId,
    campaignId: null,
    channel: input.channel,
    templateId,
    stepNumber: null,
    status: 'queued',
    messageBody: message,
  });

  const outcome = await dispatchOutbound({
    leadId,
    campaignId: null,
    channel: input.channel,
    templateId: templateId ?? 'custom',
    body: dispatchBody,
    destination,
    subject,
    mockMode: false,
    logId: log.id,
    attachments,
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
    newValue: { channel: input.channel, templateId },
    ipAddress: actor.ipAddress ?? null,
  });

  return sentLog;
}

function customEmailBodyToHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped.replace(/\r?\n/g, '<br />');
}

export async function getLeadTimeline(leadId: string, limit?: number): Promise<TimelineEntry[]> {
  const safeLimit = clampLimit(limit);
  return findTimelineByLead(leadId, safeLimit);
}
