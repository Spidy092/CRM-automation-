import type { LeadEnrollmentOptions } from '../../shared/types/leadEnrollmentOptions';
import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { googleContactProvenanceSchema } from './leads.schema';
import type { BulkTagMode } from './leads.schema';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import { normalizePhone } from '../../shared/utils/phone';
import { clampLimit, decodeCursor, encodeCursor } from '../../shared/utils/pagination';
import { resolveStageOutcome } from '../../shared/utils/leadOutcome';
import { withTransaction } from '../../shared/utils/db';
import { findActiveDefinitions } from '../custom-fields/customFields.repository';
import { validateCustomFieldValues } from '../custom-fields/customFields.service';
import { findStageById } from '../pipeline/pipeline.repository';
import { AuthenticatedUser, LeadStatus } from '../../shared/types';
import { enqueueLeadEvent, enqueueScoringCalculate, type LeadEventJob } from '../../workers/queue';
import {
  findLeadEnrollmentOptions,
  optOutLeadByEmail as optOutLeadByEmailRepo,
  countLeads,
  findExistingForDedup,
  findLeadById,
  findLeadTimeline as repoFindLeadTimeline,
  findDueFollowUpLeads,
  findLeadByIdForUpdate,
  findLeadIdsByOwner,
  findLeads,
  findLeadsByScraperLogId,
  findLeadsByIds,
  insertLead,
  softDeleteLead,
  updateLead,
  updateLeadAssignment,
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
import { createNotification } from '../notifications/notifications.service';
import {
  LeadInput,
  LeadListFilters,
  LeadListResult,
  LeadResponse,
  LeadRow,
  LeadTimelineFilters,
  LeadTimelineResult,
  toLeadResponse,
} from './leads.types';
import { cancelPendingOutreachJobs } from '../../workers/queue';

interface Actor {
  id: string;
  role: AuthenticatedUser['role'];
  ipAddress?: string | null;
}

export class BulkOwnershipError extends AppError {
  readonly code = 'ownership_via_assignment_endpoints';

  constructor(readonly leadIds: string[]) {
    super('Bulk ownership changes must use the assignment endpoints', 422);
    this.name = 'BulkOwnershipError';
  }
}

/** Actor shape used by the ownership orchestration (structural subset of Actor). */
export interface OwnershipActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

/** A deferred side effect that must run only after the outermost transaction commits. */
export type PostCommitEffect = () => Promise<void>;

/**
 * Runs post-commit effects in order. A failing effect is logged with
 * identifiers only (never PII) and never rethrown: the business write has
 * already committed, so a failed effect must not make a successful update
 * look rolled back. Callers surface durable failures (audit gaps,
 * undelivered events) through logs/metrics, not HTTP 500s.
 */
export async function runPostCommitEffects(
  effects: PostCommitEffect[],
  scope: { leadIds: string[] },
): Promise<void> {
  for (const effect of effects) {
    try {
      await effect();
    } catch (error) {
      logger.error('post-commit effect failed; committed data stands', {
        leadIds: scope.leadIds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export interface OwnershipChangeInput {
  leadId: string;
  /** Null releases the lead to unclaimed (no history row: assignments.assigned_to is NOT NULL). */
  newOwnerId: string | null;
  type: 'manual' | 'override' | 'round_robin';
  reason?: string;
  score?: number;
  classification?: string;
}

export interface OwnershipChangeResult {
  assignmentId: string | null;
  previousOwnerId: string | null;
  lead: LeadRow;
  postCommit: PostCommitEffect[];
}

/**
 * Cross-module ownership orchestration without an import cycle.
 *
 * `leads` owns `leads.assigned_to` persistence but must not import the
 * assignments module (assignments → leads is the one allowed direction).
 * The assignments module registers its orchestrator here; every supported
 * single-lead ownership path delegates through it when present. Bulk
 * ownership changes are rejected and directed to the assignment endpoints.
 * When absent, ownership-changing requests fail closed with 503 rather than
 * bypassing assignment history and notification side effects.
 */
export type OwnershipApplier = (
  input: OwnershipChangeInput,
  actor: OwnershipActor,
  client: PoolClient,
) => Promise<OwnershipChangeResult>;

let ownershipApplier: OwnershipApplier | null = null;

export function registerOwnershipApplier(applier: OwnershipApplier | null): void {
  ownershipApplier = applier;
}

/** Visible for tests; prefer `registerOwnershipApplier`. */
export function getOwnershipApplier(): OwnershipApplier | null {
  return ownershipApplier;
}

/**
 * Locks a lead row for an ownership transaction. Public service interface
 * for the assignments orchestrator (which must not touch leads tables or
 * repositories directly). Throws 404 when missing or soft-deleted.
 */
export async function lockLeadForUpdate(leadId: string, client: PoolClient): Promise<LeadRow> {
  const lead = await findLeadByIdForUpdate(leadId, client);
  if (!lead) throw new AppError('Lead not found', 404);
  return lead;
}

/**
 * Writes `leads.assigned_to` plus the `assignment_change` activity inside
 * the caller's transaction. Public service interface for the assignments
 * orchestrator — the only sanctioned writer of the ownership column.
 */
export async function writeLeadOwner(
  leadId: string,
  newOwnerId: string | null,
  actor: OwnershipActor,
  client: PoolClient,
  opts?: { previousOwnerId?: string | null },
): Promise<LeadRow> {
  const updated = await updateLeadAssignment(leadId, newOwnerId, client);
  await insertActivity(
    {
      lead_id: leadId,
      user_id: actor.role === 'system' ? null : actor.id,
      type: 'assignment_change',
      metadata: {
        from: opts?.previousOwnerId ?? null,
        to: newOwnerId,
      },
    },
    client,
  );
  return updated;
}

/** Apply only an email-bound recipient opt-out; stop pending outreach on every retry. */
export async function optOutLeadByEmail(id: string, emailHash: string): Promise<void> {
  const before = await findLeadById(id);
  if (
    !before?.email ||
    createHash('sha256').update(before.email.trim().toLowerCase()).digest('hex') !== emailHash
  ) {
    throw new AppError('This unsubscribe link is invalid or expired', 404);
  }
  const updated = await optOutLeadByEmailRepo(id, before.email);
  if (!updated) throw new AppError('This unsubscribe link is invalid or expired', 404);
  await cancelPendingOutreachJobs({ leadId: id });
  if (before.status !== 'opted_out') {
    await writeAuditLog({
      userId: null,
      action: 'lead.opted_out',
      entityType: 'lead',
      entityId: id,
      oldValue: { status: before.status },
      newValue: { status: 'opted_out', reason: 'recipient_unsubscribe' },
    });
    enqueueLeadDomainEvent({
      event: 'lead.status_changed',
      leadId: id,
      payload: { status: 'opted_out' },
    });
  }
}

/** Queue delivery is asynchronous; surface failures without creating an
 * unhandled rejection in the request that already committed the write. */
function enqueueLeadDomainEvent(event: LeadEventJob): void {
  void Promise.resolve(enqueueLeadEvent(event)).catch((error: unknown) => {
    logger.error('failed to enqueue lead domain event', {
      event: event.event,
      leadId: event.leadId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
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
  if (input.google_place_id && input.source_platform !== 'google_business') {
    throw new AppError('Google place identity requires google_business source', 422);
  }
  if (input.google_contact_provenance) {
    const parsed = googleContactProvenanceSchema.safeParse(input.google_contact_provenance);
    if (!parsed.success) throw new AppError('Invalid Google contact provenance', 422);
  }
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
    ...(prepared.google_place_id ? [prepared.google_place_id] : []),
  );
  if (existing) {
    throw new AppError(
      prepared.google_place_id
        ? 'A lead with this Google place ID already exists'
        : 'A lead with this email or phone already exists for this source platform',
      409,
    );
  }

  let created: LeadRow;
  try {
    created = await insertLead(prepared);
  } catch (error) {
    // Concurrent imports may pass the lookup together; the unique index is authoritative.
    if (
      prepared.google_place_id &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'idx_leads_google_place_id'
    ) {
      throw new AppError('A lead with this Google place ID already exists', 409);
    }
    throw error;
  }
  await writeAuditLog({
    userId: actor.id,
    action: 'lead.created',
    entityType: 'lead',
    entityId: created.id,
    newValue: toLeadResponse(created),
    ipAddress: actor.ipAddress ?? null,
  });
  // Fire-and-forget: trigger scoring automation
  enqueueLeadDomainEvent({ event: 'lead.created', leadId: created.id, payload: {} });
  return toLeadResponse(created);
}

/** Scraper-facing lookup keeps persistence behind the leads service boundary. */
export async function findScrapedLeadDuplicate(
  email: string,
  phone: string,
  sourcePlatform: string,
  googlePlaceId?: string,
): Promise<string | null> {
  const existing = await findExistingForDedup(email, phone, sourcePlatform, googlePlaceId);
  if (existing && !existing.tags?.includes(sourcePlatform)) {
    await updateLead(existing.id, {
      tags: Array.from(new Set([...(existing.tags ?? []), sourcePlatform])),
    });
  }
  return existing?.id ?? null;
}

export async function getLeadById(id: string, actor: Actor): Promise<LeadResponse> {
  const lead = await findLeadById(id);
  if (!lead) throw new AppError('Lead not found', 404);
  assertAccess(lead.assigned_to, actor, false);
  return toLeadResponse(lead);
}

/** Service interface for other modules that need to scope work to a rep's leads. */
export async function getLeadIdsOwnedBy(userId: string): Promise<string[]> {
  return findLeadIdsByOwner(userId);
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

  if (
    before.google_place_id &&
    input.source_platform !== undefined &&
    input.source_platform !== 'google_business'
  ) {
    throw new AppError('The source of an identified Google business cannot be changed', 422);
  }

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
    const clash = await findExistingForDedup(
      merged.email,
      merged.phone,
      merged.source_platform,
      ...(before.google_place_id ? [before.google_place_id] : []),
    );
    if (clash && clash.id !== id) {
      throw new AppError('Another lead with this email or phone exists for this source', 409);
    }
  }

  const includesOwner = input.assigned_to !== undefined;
  // Ownership changes must go through the registered cross-module
  // orchestrator so owner, history, notification, and activity stay aligned.
  // The transaction below returns 503 if an actual change has no applier.
  const applier = includesOwner ? getOwnershipApplier() : null;
  const { assigned_to: newOwner, ...fieldPatch } = input;

  const { response, postCommit } = await withTransaction(async (client) => {
    const effects: PostCommitEffect[] = [];

    // Re-read under lock: ownership may have changed between the
    // pre-transaction read and now. Access is re-evaluated against current
    // state so a concurrently reassigned lead cannot be written blindly.
    const locked = await findLeadByIdForUpdate(id, client);
    if (!locked) throw new AppError('Lead not found', 404);
    assertAccess(locked.assigned_to, actor, true);

    const ownershipChanged = includesOwner && newOwner !== locked.assigned_to;
    if (ownershipChanged && actor.role !== 'admin' && actor.role !== 'manager') {
      throw new AppError('Forbidden: only an admin or manager may change lead ownership', 403);
    }
    if (ownershipChanged && !applier) {
      throw new AppError('Ownership service is unavailable', 503);
    }
    let updated = await updateLead(id, includesOwner && applier ? fieldPatch : input, client);

    if (
      input.pipeline_stage_id !== undefined &&
      input.pipeline_stage_id !== locked.pipeline_stage_id
    ) {
      await insertActivity(
        {
          lead_id: id,
          user_id: actor.id,
          type: 'status_change',
          metadata: {
            field: 'pipeline_stage_id',
            from: locked.pipeline_stage_id,
            to: updated.pipeline_stage_id,
          },
        },
        client,
      );

      // Deals moved into (or out of) a Closed Won/Lost stage carry their
      // outcome automatically — see resolveStageOutcome() for the exact rules.
      const stage = input.pipeline_stage_id ? await findStageById(input.pipeline_stage_id) : null;
      const outcome = resolveStageOutcome(locked.status, stage);
      if (outcome) {
        updated = await updateLeadOutcome(id, outcome, client);
        await insertActivity(
          {
            lead_id: id,
            user_id: actor.id,
            type: 'status_change',
            metadata: {
              field: 'status',
              from: locked.status,
              to: outcome,
              reason: 'pipeline_stage_move',
            },
          },
          client,
        );
      }
    }

    if (ownershipChanged && applier) {
      const applied = await applier(
        {
          leadId: id,
          newOwnerId: newOwner ?? null,
          type: locked.assigned_to ? 'override' : 'manual',
        },
        actor,
        client,
      );
      effects.push(...applied.postCommit);
      updated = applied.lead;
    }

    // Audit and domain events are post-commit effects: they must never
    // observe (or imply success of) a rolled-back write, and their failure
    // must not fail an already-committed update.
    effects.push(() =>
      writeAuditLog({
        userId: actor.id,
        action: 'lead.updated',
        entityType: 'lead',
        entityId: id,
        oldValue: toLeadResponse(before),
        newValue: toLeadResponse(updated),
        ipAddress: actor.ipAddress ?? null,
      }),
    );
    queueLeadUpdateEvents(id, before, updated, effects, input);

    return { response: toLeadResponse(updated), postCommit: effects };
  });

  await runPostCommitEffects(postCommit, { leadIds: [id] });
  return response;
}

/**
 * Collects the workflow-trigger domain events for a lead update as deferred
 * post-commit effects. Kept beside updateLeadFields so bulk updates reuse
 * the identical event contract.
 */
function queueLeadUpdateEvents(
  id: string,
  before: LeadRow,
  updated: LeadRow,
  effects: PostCommitEffect[],
  input: Partial<LeadInput>,
): void {
  const changedFields = Object.keys(input).filter(
    (key) =>
      JSON.stringify(before[key as keyof typeof before]) !==
      JSON.stringify(updated[key as keyof typeof updated]),
  );
  if (changedFields.length > 0) {
    const payload = Object.fromEntries(
      changedFields.map((key) => [key, updated[key as keyof typeof updated]]),
    );
    effects.push(() => {
      enqueueLeadDomainEvent({ event: 'lead.updated', leadId: id, payload });
      return Promise.resolve();
    });
  }
  if (before.pipeline_stage_id !== updated.pipeline_stage_id) {
    effects.push(() => {
      enqueueLeadDomainEvent({
        event: 'lead.stage_moved',
        leadId: id,
        payload: {
          fromStageId: before.pipeline_stage_id,
          toStageId: updated.pipeline_stage_id,
        },
      });
      return Promise.resolve();
    });
  }
  if (before.assigned_to !== updated.assigned_to) {
    effects.push(() => {
      enqueueLeadDomainEvent({
        event: 'lead.assigned',
        leadId: id,
        payload: { assignedTo: updated.assigned_to },
      });
      return Promise.resolve();
    });
  }
  const addedTags = (updated.tags ?? []).filter((tag) => !(before.tags ?? []).includes(tag));
  for (const tag of addedTags) {
    effects.push(() => {
      enqueueLeadDomainEvent({ event: 'lead.tag_added', leadId: id, payload: { tag } });
      return Promise.resolve();
    });
  }
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
      throw new AppError(
        `Cannot pause lead with status "${before.status}". Only active leads can be paused.`,
        400,
      );
    }
  } else {
    if (before.status === 'active') {
      return toLeadResponse(before);
    }
    if (before.status !== 'paused') {
      throw new AppError(
        `Cannot resume lead with status "${before.status}". Only paused leads can be resumed.`,
        400,
      );
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
  enqueueLeadDomainEvent({
    event: 'lead.status_changed',
    leadId: id,
    payload: { status: targetStatus },
  });
  return toLeadResponse(updated);
}

export async function getLeadTimeline(
  id: string,
  actor: Actor,
  filters: Omit<LeadTimelineFilters, 'leadId'>,
): Promise<LeadTimelineResult> {
  const lead = await findLeadById(id);
  if (!lead) throw new AppError('Lead not found', 404);
  assertAccess(lead.assigned_to, actor, false);
  return repoFindLeadTimeline({
    leadId: id,
    limit: Math.min(Math.max(filters.limit, 1), 100),
    cursorTs: filters.cursorTs,
    cursorId: filters.cursorId,
    kind: filters.kind,
    search: filters.search,
    channel: filters.channel,
    authorId: filters.authorId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    pinnedOnly: filters.pinnedOnly,
  });
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
  tagMode: BulkTagMode = 'replace',
): Promise<number> {
  if (ids.length === 0) return 0;
  if (patch.assigned_to !== undefined) throw new BulkOwnershipError(ids);

  if (tagMode === 'append') {
    const leads = await findLeadsByIds(ids);
    for (const lead of leads) assertAccess(lead.assigned_to, actor, true);
    const tags = [...new Set((patch.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
    if (!tags.length) return 0;
    const updated = await repoBulkUpdate(
      leads.map((lead) => lead.id),
      { tags },
      true,
    );
    await writeAuditLog({
      userId: actor.id,
      action: 'lead.bulk_tags_added',
      entityType: 'lead',
      entityId: 'bulk',
      newValue: { ids: leads.map((lead) => lead.id), tags, updated },
      ipAddress: actor.ipAddress ?? null,
    });
    for (const lead of leads) {
      for (const tag of tags.filter((tag) => !(lead.tags ?? []).includes(tag))) {
        enqueueLeadDomainEvent({ event: 'lead.tag_added', leadId: lead.id, payload: { tag } });
      }
    }
    return updated;
  }

  if (patch.source_platform !== undefined && patch.source_platform !== 'google_business') {
    const leads = await findLeadsByIds(ids);
    if (leads.some((lead) => lead.google_place_id)) {
      throw new AppError('The source of an identified Google business cannot be changed', 422);
    }
  }

  if (patch.custom_fields !== undefined) {
    const defs = await findActiveDefinitions();
    const result = validateCustomFieldValues(defs, patch.custom_fields ?? null);
    if (!result.valid) {
      throw new AppError(`Invalid custom fields: ${result.errors.join('; ')}`, 422);
    }
    patch.custom_fields = result.sanitized;
  }

  const existing = await findLeadsByIds(ids);
  for (const lead of existing) assertAccess(lead.assigned_to, actor, true);

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
          throw new AppError(
            'Target stage belongs to a different pipeline than the lead’s current pipeline',
            400,
          );
        }
      }

      // H1: Closed lead protection
      const isLeadClosed = ['won', 'lost', 'opted_out'].includes(lead.status);
      if (isLeadClosed && !isTargetTerminal) {
        throw new AppError(
          'Cannot move a closed (won/lost/opted_out) lead to an active stage. Reopen the lead status first.',
          400,
        );
      }

      // H2: Resolve stage outcome side-effects
      const outcome = resolveStageOutcome(lead.status, targetStage);
      if (outcome) {
        await updateLeadOutcome(leadId, outcome);
        await insertActivity({
          lead_id: leadId,
          user_id: actor.id,
          type: 'status_change',
          metadata: {
            field: 'status',
            from: lead.status,
            to: outcome,
            reason: 'bulk_pipeline_stage_move',
          },
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

export async function notifyDueFollowUps(limit = 100): Promise<number> {
  let notified = 0;
  let after: { nextFollowUpAt: string; id: string } | undefined;
  let hasMore = true;

  while (hasMore) {
    const leads = await findDueFollowUpLeads(limit, after);
    for (const lead of leads) {
      if (!lead.assigned_to || !lead.next_follow_up_at) continue;
      const result = await createNotification({
        recipientUserId: lead.assigned_to,
        occurrenceKey: `follow-up:${lead.id}:${lead.next_follow_up_at}`,
        type: 'follow_up_due',
        title: 'Follow-up due',
        message: `Follow up with ${lead.business_name}.`,
        metadata: { leadId: lead.id, deepLink: `/leads/${lead.id}` },
      });
      if (result.ok && result.value.created) notified += 1;
      if (!result.ok) {
        logger.error('Failed to create due follow-up notification', {
          leadId: lead.id,
          recipientUserId: lead.assigned_to,
          error: result.error.message,
        });
      }
    }

    const lastLead = leads[leads.length - 1];
    hasMore = leads.length === limit && Boolean(lastLead?.next_follow_up_at);
    if (hasMore && lastLead?.next_follow_up_at) {
      after = { nextFollowUpAt: lastLead.next_follow_up_at, id: lastLead.id };
    }
  }

  return notified;
}

export { clampLimit, decodeCursor };

export async function getLeadEnrollmentOptions(): Promise<LeadEnrollmentOptions> {
  return findLeadEnrollmentOptions();
}
