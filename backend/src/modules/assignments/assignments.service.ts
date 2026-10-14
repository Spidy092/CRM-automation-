import { withTransaction } from '../../shared/utils/db';
import type { PoolClient } from 'pg';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import type { UserRole } from '../../shared/types';
import { createNotification } from '../notifications/notifications.service';
import {
  lockLeadForUpdate,
  registerOwnershipApplier,
  runPostCommitEffects,
  writeLeadOwner,
  type OwnershipActor,
  type PostCommitEffect,
} from '../leads/leads.service';
import type { LeadRow } from '../leads/leads.types';
import { getEligibleRecipientForUpdate } from '../users/users.service';
import {
  findAssignmentConfig,
  updateAssignmentConfig,
  findEligibleUsers,
  insertAssignment,
  findAssignmentsByUser,
  getNextRoundRobinUser,
} from './assignments.repository';
import { Assignment, AssignmentConfig, RoundRobinUser } from './assignments.types';

interface Actor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

/**
 * Actor id used for system-originated assignments (round-robin worker).
 * Never a real user id: HTTP actors always carry database UUIDs from
 * verified JWTs, so this sentinel can only originate inside the codebase.
 */
export const SYSTEM_ACTOR_ID = 'system';

const KNOWN_ROLES: UserRole[] = ['admin', 'manager', 'sales', 'marketing', 'viewer'];

function sanitizeRoles(roles: unknown): UserRole[] {
  if (!Array.isArray(roles)) return ['sales'];
  const kept = roles.filter((r): r is UserRole => KNOWN_ROLES.includes(r as UserRole));
  return kept.length > 0 ? kept : ['sales'];
}

export async function getConfig(): Promise<AssignmentConfig | null> {
  return findAssignmentConfig();
}

export async function updateConfig(
  data: { is_enabled?: boolean; threshold_score?: number; eligible_roles?: string[] },
  actor: Actor,
): Promise<AssignmentConfig> {
  const config = await updateAssignmentConfig(data, actor.id);

  await writeAuditLog({
    userId: actor.id,
    action: 'assignment_config.updated',
    entityType: 'assignment_config',
    entityId: config.id,
    newValue: config,
    ipAddress: actor.ipAddress ?? null,
  });

  return config;
}

export async function getEligibleUsers(): Promise<RoundRobinUser[]> {
  const config = await findAssignmentConfig();
  return findEligibleUsers(sanitizeRoles(config?.eligible_roles));
}

export interface ApplyOwnershipChangeInput {
  leadId: string;
  newOwnerId: string | null;
  type: 'manual' | 'override' | 'round_robin';
  reason?: string;
  score?: number;
  classification?: string;
  /**
   * Conflict policy for a currently owned lead. `throw` preserves the
   * manual-assignment 409; `skip` returns null so duplicate worker delivery
   * and races with manual assignment are safe no-ops instead of retries.
   */
  ifOwned?: 'throw' | 'skip';
  /** Round-robin recipients must additionally still be available. */
  requireAvailable?: boolean;
  /** Role allowlist for the recipient; null skips the role check (active only). */
  allowedRoles?: UserRole[] | null;
}

export interface ApplyOwnershipChangeResult {
  assignment: Assignment | null;
  previousOwnerId: string | null;
  lead: LeadRow | null;
  postCommit: PostCommitEffect[];
}

/**
 * Single ownership orchestrator for every ownership mutation (manual,
 * override, round-robin, and — via the registered applier — generic lead
 * updates, bulk updates, and workflow actions).
 *
 * Transaction ownership: opens its own transaction when no client is given,
 * otherwise joins the caller's. Lock order is always lead row first, then
 * recipient user row (see users.service `getEligibleRecipientForUpdate`);
 * bulk callers additionally sort lead ids ascending. All participating
 * writes (lead owner, history row, notification row) share the one client;
 * audit, SSE publish, and event enqueue run post-commit via the returned
 * effects and never fail the committed update.
 */
export async function applyOwnershipChange(
  input: ApplyOwnershipChangeInput,
  actor: Actor,
  outerClient?: PoolClient,
): Promise<ApplyOwnershipChangeResult> {
  const run = async (client: PoolClient): Promise<ApplyOwnershipChangeResult> => {
    const postCommit: PostCommitEffect[] = [];

    // Lock the lead first: concurrent writers of the same lead serialize
    // here, and the guard below sees current truth, not a stale read.
    const lead = await lockLeadForUpdate(input.leadId, client);
    const previousOwnerId = lead.assigned_to;

    if (previousOwnerId && input.type === 'manual' && input.ifOwned !== 'skip') {
      throw new AppError('Lead already has an active assignment', 409);
    }
    if (previousOwnerId && input.ifOwned === 'skip') {
      // Already owned (duplicate worker delivery or a lost race with a
      // manual assignment): safe no-op, no new history, no notification.
      logger.info('ownership change skipped: lead already owned', {
        leadId: input.leadId,
        assignedTo: previousOwnerId,
        type: input.type,
      });
      return { assignment: null, previousOwnerId, lead, postCommit };
    }

    let recipientName: string | null = lead.business_name ?? null;
    if (input.newOwnerId) {
      // Revalidate the recipient inside the transaction: a rep deactivated
      // (or role-changed) after selection must not receive the lead.
      const recipient = await getEligibleRecipientForUpdate(input.newOwnerId, client, {
        allowedRoles: input.allowedRoles ?? undefined,
        requireAvailable: input.requireAvailable,
      });
      recipientName = recipient.name ?? recipientName;
    }

    const updatedLead = await writeLeadOwner(input.leadId, input.newOwnerId, actor, client, {
      previousOwnerId,
    });

    let assignment: Assignment | null = null;
    if (input.newOwnerId) {
      // History rows require a real user (assignments.assigned_to is NOT
      // NULL); releases to unclaimed record owner/activity/audit only.
      // `assigned_by` is null for system-originated writes: the column is a
      // UUID FK and the 'system' sentinel is not a user id.
      const assignedBy = actor.id && actor.id !== SYSTEM_ACTOR_ID ? actor.id : null;
      assignment = await insertAssignment(
        input.leadId,
        input.newOwnerId,
        assignedBy,
        input.type,
        client,
      );

      const scoreSuffix =
        input.score !== undefined || input.classification !== undefined
          ? ` (score ${input.score ?? '?'}, ${input.classification ?? '?'})`
          : '';
      const notifResult = await createNotification(
        {
          recipientUserId: input.newOwnerId,
          // Stable per history row: a retried execution that already wrote
          // this row dedupes here instead of notifying twice.
          occurrenceKey: `assignment:${assignment.id}`,
          type: 'lead_assigned',
          title: input.type === 'override' ? 'Lead reassigned' : 'New lead assigned',
          message: `${recipientName ?? 'A lead'}${scoreSuffix} was assigned to you.`,
          metadata: {
            leadId: input.leadId,
            ...(input.score !== undefined ? { score: input.score } : {}),
            ...(input.classification !== undefined ? { classification: input.classification } : {}),
          },
        },
        client,
      );

      if (!notifResult.ok) {
        logger.error('Failed to persist assignment notification', {
          leadId: input.leadId,
          assignmentId: assignment.id,
          error: notifResult.error.message,
        });
        throw notifResult.error;
      }

      const publishLiveSignal = notifResult.value.publishLiveSignal;
      postCommit.push(async () => {
        if (publishLiveSignal) await publishLiveSignal();
      });
    }

    const auditAction =
      input.type === 'override'
        ? 'assignment.override'
        : input.type === 'round_robin'
          ? 'assignment.round_robin'
          : 'assignment.manual';
    postCommit.push(() =>
      writeAuditLog({
        userId: actor.id && actor.id !== SYSTEM_ACTOR_ID ? actor.id : null,
        action: auditAction,
        entityType: 'assignment',
        entityId: assignment?.id ?? input.leadId,
        newValue: {
          lead_id: input.leadId,
          previous_owner_id: previousOwnerId,
          assigned_to: input.newOwnerId,
          ...(input.reason ? { reason: input.reason } : {}),
        },
        ipAddress: actor.ipAddress ?? null,
      }),
    );

    return { assignment, previousOwnerId, lead: updatedLead, postCommit };
  };

  if (outerClient) return run(outerClient);
  const out = await withTransaction(run);
  await runPostCommitEffects(out.postCommit, { leadIds: [input.leadId] });
  return out;
}

export async function assignManually(
  leadId: string,
  userId: string,
  actor: Actor,
): Promise<Assignment> {
  const out = await applyOwnershipChange(
    { leadId, newOwnerId: userId, type: 'manual', ifOwned: 'throw' },
    actor,
  );
  // applyOwnershipChange with ifOwned:'throw' always produces an assignment:
  // success implies a non-null row (release paths cannot occur here since
  // newOwnerId is a real user id).
  if (!out.assignment) throw new AppError('Lead already has an active assignment', 409);
  return out.assignment;
}

export async function overrideAssignment(
  leadId: string,
  newUserId: string,
  reason: string,
  actor: Actor,
): Promise<Assignment> {
  const out = await applyOwnershipChange(
    { leadId, newOwnerId: newUserId, type: 'override', reason },
    actor,
  );
  if (!out.assignment) throw new AppError('Lead already has an active assignment', 409);
  return out.assignment;
}

export interface AutoAssignResult {
  assignment: Assignment;
  previousOwnerId: string | null;
}

export async function autoAssignLead(
  leadId: string,
  opts?: { score?: number; classification?: string },
): Promise<AutoAssignResult | null> {
  const config = await findAssignmentConfig();
  if (!config || !config.is_enabled) {
    return null;
  }
  const roles = sanitizeRoles(config.eligible_roles);

  const nextUser = await getNextRoundRobinUser(roles);
  if (!nextUser) {
    return null;
  }

  const systemActor: OwnershipActor = { id: SYSTEM_ACTOR_ID, role: 'system' };
  const out = await applyOwnershipChange(
    {
      leadId,
      newOwnerId: nextUser.id,
      type: 'round_robin',
      score: opts?.score,
      classification: opts?.classification,
      ifOwned: 'skip',
      requireAvailable: true,
      allowedRoles: roles,
    },
    systemActor,
  );
  if (!out.assignment) return null;

  return {
    assignment: out.assignment,
    previousOwnerId: out.previousOwnerId,
  };
}

export async function getUserAssignments(userId: string): Promise<Assignment[]> {
  return findAssignmentsByUser(userId);
}

/**
 * Wires the assignments orchestrator into the leads service without a
 * static import cycle (assignments → leads is the one allowed direction;
 * leads.service must never import this module). Every ownership path in
 * leads.service — single update, bulk update, and therefore the
 * workflow/agent callers built on them — delegates through this applier
 * when the module is loaded, which it always is in server and worker
 * processes via controllers and the assignment worker.
 */
registerOwnershipApplier(async (input, actor, client) => {
  const out = await applyOwnershipChange(
    {
      leadId: input.leadId,
      newOwnerId: input.newOwnerId,
      type: input.type,
      reason: input.reason,
      score: input.score,
      classification: input.classification,
      // The lead service distinguishes an initial assignment from an
      // ownership transfer using the locked current owner.
      ifOwned: input.type === 'manual' ? 'throw' : undefined,
    },
    { id: actor.id, role: actor.role, ipAddress: actor.ipAddress ?? null },
    client,
  );
  if (!out.lead) {
    throw new AppError('Lead already has an active assignment', 409);
  }
  return {
    assignmentId: out.assignment?.id ?? null,
    previousOwnerId: out.previousOwnerId,
    lead: out.lead,
    postCommit: out.postCommit,
  };
});
