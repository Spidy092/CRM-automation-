import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { normalizePhone } from '../../shared/utils/phone';
import { clampLimit, decodeCursor, encodeCursor } from '../../shared/utils/pagination';
import { resolveStageOutcome } from '../../shared/utils/leadOutcome';
import { findActiveDefinitions } from '../custom-fields/customFields.repository';
import { validateCustomFieldValues } from '../custom-fields/customFields.service';
import { findStageById } from '../pipeline/pipeline.repository';
import { AuthenticatedUser, LeadStatus } from '../../shared/types';
import { enqueueLeadEvent, enqueueScoringCalculate } from '../../workers/queue';
import {
  countLeads,
  findExistingForDedup,
  findLeadById,
  findLeads,
  findLeadsByScraperLogId,
  findLeadsByIds,
  insertLead,
  softDeleteLead,
  updateLead,
  updateLeadStatus,
  updateLeadOutcome,
  findActivityForLead,
  bulkClassifyLeads as repoBulkClassify,
  bulkUpdateLeads as repoBulkUpdate,
  bulkPauseLeads as repoBulkPause,
  type LeadActivityEntry,
} from './leads.repository';
import {
  createOutboundActivityAndUpdateLead,
  insertActivity,
} from '../activities/activities.repository';
import { Activity } from '../activities/activities.types';
import {
  LeadInput,
  LeadListFilters,
  LeadListResult,
  LeadResponse,
  toLeadResponse,
} from './leads.types';
import { cancelPendingOutreachJobs } from '../../workers/queue';

interface Actor {
  id: string;
  role: AuthenticatedUser['role'];
  ipAddress?: string | null;
}

/** Sales reps are scoped to their own assigned leads; others see all. */
function applyScope(filters: LeadListFilters, actor: Actor): LeadListFilters {
  if (actor.role === 'sales') {
    return { ...filters, assigned_to: actor.id };
  }
  return filters;
}

/** Resource-level ownership: sales reps may only touch leads assigned to them. */
export function assertAccess(assignedTo: string | null, actor: Actor, write: boolean): void {
  if (actor.role === 'admin' || actor.role === 'manager') return;
  if (actor.role === 'marketing' || actor.role === 'viewer') {
    if (write) throw new AppError('Forbidden: read-only role', 403);
    return;
  }
  // sales
  if (assignedTo === actor.id) return;
  throw new AppError('Forbidden: you can only access leads assigned to you', 403);
}

async function prepareInput(input: LeadInput): Promise<LeadInput> {
  const normalized: LeadInput = {
    ...input,
    email: input.email.trim().toLowerCase(),
    phone: normalizePhone(input.phone),
  };

  // Validate custom_fields against active definitions (AGENTS.md rule).
  const defs = await findActiveDefinitions();
  const result = validateCustomFieldValues(defs, normalized.custom_fields ?? null);
  if (!result.valid) {
    throw new AppError(`Invalid custom fields: ${result.errors.join('; ')}`, 422);
  }
  normalized.custom_fields = result.sanitized;
  return normalized;
}

export async function createLead(input: LeadInput, actor: Actor): Promise<LeadResponse> {
  const prepared = await prepareInput(input);

  const existing = await findExistingForDedup(
    prepared.email,
    prepared.phone,
    prepared.source_platform,
  );
  if (existing) {
    throw new AppError(
      'A lead with this email or phone already exists for this source platform',
      409,
    );
  }

  const created = await insertLead(prepared);
  await writeAuditLog({
    userId: actor.id,
    action: 'lead.created',
    entityType: 'lead',
    entityId: created.id,
    newValue: toLeadResponse(created),
    ipAddress: actor.ipAddress ?? null,
  });
  // Fire-and-forget: trigger scoring automation
  void enqueueLeadEvent({ event: 'lead.created', leadId: created.id, payload: {} });
  return toLeadResponse(created);
}

export async function getLeadById(id: string, actor: Actor): Promise<LeadResponse> {
  const lead = await findLeadById(id);
  if (!lead) throw new AppError('Lead not found', 404);
  assertAccess(lead.assigned_to, actor, false);
  return toLeadResponse(lead);
}

/**
 * Leads created by a specific scraper run. Read-only, so it does not apply
 * the sales-rep assignment scope — a rep can see which leads a source
 * produced even if some were assigned to other reps.
 */
export async function getLeadsByScraperLogId(scraperLogId: string): Promise<LeadResponse[]> {
  const rows = await findLeadsByScraperLogId(scraperLogId);
  return rows.map(toLeadResponse);
}

/** Leads matching the given IDs — used to resolve which existing leads a run's duplicates matched. */
export async function getLeadsByIds(ids: string[]): Promise<LeadResponse[]> {
  const rows = await findLeadsByIds(ids);
  return rows.map(toLeadResponse);
}

export async function listLeads(
  rawFilters: LeadListFilters,
  actor: Actor,
): Promise<LeadListResult> {
  const filters = applyScope(rawFilters, actor);
  const [{ rows, hasMore }, total] = await Promise.all([
    findLeads(filters),
    filters.countTotal ? countLeads(filters) : Promise.resolve(undefined),
  ]);

  // A cursor is only meaningful for the default newest-first ordering; offset
  // paging and custom sorts page by `offset` instead.
  const isKeyset =
    filters.offset === undefined &&
    (filters.sortBy ?? 'created_at') === 'created_at' &&
    (filters.sortDir ?? 'desc') === 'desc';

  let nextCursor: string | undefined;
  if (isKeyset && hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor({ ts: last.created_at, id: last.id });
  }

  return {
    items: rows.map(toLeadResponse),
    meta: {
      limit: filters.limit,
      hasMore,
      nextCursor,
      ...(total !== undefined ? { total } : {}),
      ...(filters.offset !== undefined ? { offset: filters.offset } : {}),
    },
  };
}

export async function updateLeadFields(
  id: string,
  input: Partial<LeadInput>,
  actor: Actor,
): Promise<LeadResponse> {
  const before = await findLeadById(id);
  if (!before) throw new AppError('Lead not found', 404);
  assertAccess(before.assigned_to, actor, true);

  // Merge so custom-field validation sees the full final shape.
  const merged: LeadInput = {
    business_name: before.business_name,
    contact_name: before.contact_name,
    phone: before.phone,
    email: before.email,
    website: before.website,
    industry: before.industry,
    location: before.location,
    country: before.country,
    google_rating: before.google_rating === null ? null : Number(before.google_rating),
    review_count: before.review_count,
    social_links: before.social_links,
    source_platform: before.source_platform,
    assigned_to: before.assigned_to,
    pipeline_stage_id: before.pipeline_stage_id,
    custom_fields: before.custom_fields,
    tags: before.tags,
    notes: before.notes,
    ...input,
  };

  // Re-normalize identifiers when they changed.
  if (input.email) merged.email = input.email.trim().toLowerCase();
  if (input.phone) merged.phone = normalizePhone(input.phone);

  // Validate the merged custom_fields.
  const defs = await findActiveDefinitions();
  const result = validateCustomFieldValues(defs, merged.custom_fields ?? null);
  if (!result.valid) {
    throw new AppError(`Invalid custom fields: ${result.errors.join('; ')}`, 422);
  }
  input.custom_fields = result.sanitized;

  // If email/phone changed, ensure no dedup collision with a different lead.
  if (input.email || input.phone) {
    const clash = await findExistingForDedup(merged.email, merged.phone, merged.source_platform);
    if (clash && clash.id !== id) {
      throw new AppError('Another lead with this email or phone exists for this source', 409);
    }
  }

  let updated = await updateLead(id, input);

  if (
    input.pipeline_stage_id !== undefined &&
    input.pipeline_stage_id !== before.pipeline_stage_id
  ) {
    await insertActivity({
      lead_id: id,
      user_id: actor.id,
      type: 'status_change',
      metadata: {
        field: 'pipeline_stage_id',
        from: before.pipeline_stage_id,
        to: updated.pipeline_stage_id,
      },
    });

    // Deals moved into (or out of) a Closed Won/Lost stage carry their
    // outcome automatically — see resolveStageOutcome() for the exact rules.
    const stage = input.pipeline_stage_id ? await findStageById(input.pipeline_stage_id) : null;
    const outcome = resolveStageOutcome(before.status, stage);
    if (outcome) {
      updated = await updateLeadOutcome(id, outcome);
      await insertActivity({
        lead_id: id,
        user_id: actor.id,
        type: 'status_change',
        metadata: {
          field: 'status',
          from: before.status,
          to: outcome,
          reason: 'pipeline_stage_move',
        },
      });
    }
  }

  if (input.assigned_to !== undefined && input.assigned_to !== before.assigned_to) {
    await insertActivity({
      lead_id: id,
      user_id: actor.id,
      type: 'assignment_change',
      metadata: {
        from: before.assigned_to,
        to: updated.assigned_to,
      },
    });
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'lead.updated',
    entityType: 'lead',
    entityId: id,
    oldValue: toLeadResponse(before),
    newValue: toLeadResponse(updated),
    ipAddress: actor.ipAddress ?? null,
  });
  return toLeadResponse(updated);
}

export async function softDeleteLeadById(id: string, actor: Actor): Promise<void> {
  const before = await findLeadById(id);
  if (!before) throw new AppError('Lead not found', 404);
  await softDeleteLead(id);
  await writeAuditLog({
    userId: actor.id,
    action: 'lead.deleted',
    entityType: 'lead',
    entityId: id,
    oldValue: toLeadResponse(before),
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function setLeadPaused(
  id: string,
  paused: boolean,
  actor: Actor,
  reason?: string,
): Promise<LeadResponse> {
  const before = await findLeadById(id);
  if (!before) throw new AppError('Lead not found', 404);
  assertAccess(before.assigned_to, actor, true);

  if (paused) {
    if (before.status === 'paused') {
      return toLeadResponse(before);
    }
    if (['won', 'lost', 'opted_out'].includes(before.status)) {
      throw new AppError(`Cannot pause lead with status "${before.status}". Only active leads can be paused.`, 400);
    }
  } else {
    if (before.status === 'active') {
      return toLeadResponse(before);
    }
    if (before.status !== 'paused') {
      throw new AppError(`Cannot resume lead with status "${before.status}". Only paused leads can be resumed.`, 400);
    }
  }

  const targetStatus: LeadStatus = paused ? 'paused' : 'active';
  const updated = await updateLeadStatus(id, targetStatus);
  if (paused) {
    await cancelPendingOutreachJobs({ leadId: id });
  }

  await insertActivity({
    lead_id: id,
    user_id: actor.id,
    type: 'status_change',
    metadata: {
      field: 'status',
      from: before.status,
      to: targetStatus,
      reason: reason ?? (paused ? 'manual_pause' : 'manual_resume'),
    },
  });

  await writeAuditLog({
    userId: actor.id,
    action: paused ? 'lead.paused' : 'lead.resumed',
    entityType: 'lead',
    entityId: id,
    oldValue: { status: before.status },
    newValue: { status: targetStatus, reason: reason ?? null },
    ipAddress: actor.ipAddress ?? null,
  });
  return toLeadResponse(updated);
}

export async function getLeadActivity(
  id: string,
  actor: Actor,
  limit = 50,
): Promise<LeadActivityEntry[]> {
  const lead = await findLeadById(id);
  if (!lead) throw new AppError('Lead not found', 404);
  assertAccess(lead.assigned_to, actor, false);
  return findActivityForLead(id, Math.min(limit, 200));
}

export async function logOutboundActivity(
  leadId: string,
  userId: string,
  type: 'call' | 'whatsapp' | 'email',
  metadata?: Record<string, unknown>,
): Promise<Activity> {
  return createOutboundActivityAndUpdateLead({
    lead_id: leadId,
    user_id: userId,
    type,
    metadata,
  });
}

/**
 * Bulk-set the classification on a list of leads.
 * Admin / Manager only (enforced at route level; service writes the audit log).
 */
export async function bulkClassifyLeads(
  ids: string[],
  classification: import('../../shared/types').LeadClassification,
  actor: Actor,
): Promise<number> {
  const updated = await repoBulkClassify(ids, classification);
  if (updated > 0) {
    for (const leadId of ids) {
      await enqueueScoringCalculate(leadId);
    }
  }
  await writeAuditLog({
    userId: actor.id,
    action: 'lead.bulk_classified',
    entityType: 'lead',
    entityId: 'bulk',
    newValue: { ids, classification, updated },
    ipAddress: actor.ipAddress ?? null,
  });
  return updated;
}

export async function bulkUpdateLeads(
  ids: string[],
  patch: Partial<LeadInput>,
  actor: Actor,
): Promise<number> {
  if (ids.length === 0) return 0;

  if (patch.custom_fields !== undefined) {
    const defs = await findActiveDefinitions();
    const result = validateCustomFieldValues(defs, patch.custom_fields ?? null);
    if (!result.valid) {
      throw new AppError(`Invalid custom fields: ${result.errors.join('; ')}`, 422);
    }
    patch.custom_fields = result.sanitized;
  }

  if (patch.pipeline_stage_id !== undefined && patch.pipeline_stage_id !== null) {
    const targetStage = await findStageById(patch.pipeline_stage_id);
    if (!targetStage) {
      throw new AppError('Pipeline stage not found', 404);
    }
    const isTargetTerminal = targetStage.is_terminal_won || targetStage.is_terminal_lost;

    for (const leadId of ids) {
      const lead = await findLeadById(leadId);
      if (!lead) continue;

      // H3: Cross-pipeline validation
      if (lead.pipeline_stage_id) {
        const currentStage = await findStageById(lead.pipeline_stage_id);
        if (currentStage && currentStage.pipeline_id !== targetStage.pipeline_id) {
          throw new AppError('Target stage belongs to a different pipeline than the lead’s current pipeline', 400);
        }
      }

      // H1: Closed lead protection
      const isLeadClosed = ['won', 'lost', 'opted_out'].includes(lead.status);
      if (isLeadClosed && !isTargetTerminal) {
        throw new AppError('Cannot move a closed (won/lost/opted_out) lead to an active stage. Reopen the lead status first.', 400);
      }

      // H2: Resolve stage outcome side-effects
      const outcome = resolveStageOutcome(lead.status, targetStage);
      if (outcome) {
        await updateLeadOutcome(leadId, outcome);
        await insertActivity({
          lead_id: leadId,
          user_id: actor.id,
          type: 'status_change',
          metadata: { field: 'status', from: lead.status, to: outcome, reason: 'bulk_pipeline_stage_move' },
        });
      }
    }
  }

  const updated = await repoBulkUpdate(ids, patch);
  await writeAuditLog({
    userId: actor.id,
    action: 'lead.bulk_updated',
    entityType: 'lead',
    entityId: 'bulk',
    newValue: { ids, patch, updated },
    ipAddress: actor.ipAddress ?? null,
  });
  return updated;
}

export async function bulkPauseLeads(
  ids: string[],
  paused: boolean,
  actor: Actor,
): Promise<{ updated: number; cancelledJobs: number }> {
  if (ids.length === 0) return { updated: 0, cancelledJobs: 0 };

  const targetStatus: LeadStatus = paused ? 'paused' : 'active';
  const updated = await repoBulkPause(ids, targetStatus);
  let cancelledJobs = 0;
  if (paused) {
    for (const leadId of ids) {
      const count = await cancelPendingOutreachJobs({ leadId });
      if (typeof count === 'number' && !isNaN(count)) {
        cancelledJobs += count;
      }
    }
  }

  await writeAuditLog({
    userId: actor.id,
    action: paused ? 'lead.bulk_paused' : 'lead.bulk_resumed',
    entityType: 'lead',
    entityId: 'bulk',
    newValue: { ids, paused, updated, cancelledJobs },
    ipAddress: actor.ipAddress ?? null,
  });
  return { updated, cancelledJobs };
}

export { clampLimit, decodeCursor };
