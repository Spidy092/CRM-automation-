import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { normalizePhone } from '../../shared/utils/phone';
import { clampLimit, decodeCursor, encodeCursor } from '../../shared/utils/pagination';
import { resolveStageOutcome } from '../../shared/utils/leadOutcome';
import { findActiveDefinitions } from '../custom-fields/customFields.repository';
import { validateCustomFieldValues } from '../custom-fields/customFields.service';
import { findStageById } from '../pipeline/pipeline.repository';
import { AuthenticatedUser, LeadStatus } from '../../shared/types';
import { enqueueLeadEvent } from '../../workers/queue';
import {
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
  const { rows, hasMore } = await findLeads(filters);

  let nextCursor: string | undefined;
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor({ ts: last.created_at, id: last.id });
  }

  return {
    items: rows.map(toLeadResponse),
    meta: { limit: filters.limit, hasMore, nextCursor },
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
): Promise<LeadResponse> {
  const before = await findLeadById(id);
  if (!before) throw new AppError('Lead not found', 404);
  assertAccess(before.assigned_to, actor, true);

  const targetStatus: LeadStatus = paused ? 'paused' : 'active';
  if (before.status === targetStatus) {
    return toLeadResponse(before);
  }

  const updated = await updateLeadStatus(id, targetStatus);
  if (paused) {
    await cancelPendingOutreachJobs({ leadId: id });
  }
  await writeAuditLog({
    userId: actor.id,
    action: paused ? 'lead.paused' : 'lead.resumed',
    entityType: 'lead',
    entityId: id,
    oldValue: { status: before.status },
    newValue: { status: targetStatus },
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

export { clampLimit, decodeCursor };
