import { withTransaction } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import { findLeadById } from '../leads/leads.repository';
import { createNotification } from '../notifications/notifications.service';
import {
  findAssignmentConfig,
  updateAssignmentConfig,
  findEligibleUsers,
  insertAssignment,
  findAssignmentByLead,
  findAssignmentsByUser,
  updateLeadAssignment,
  getNextRoundRobinUser,
} from './assignments.repository';
import { Assignment, AssignmentConfig, RoundRobinUser } from './assignments.types';

interface Actor {
  id: string;
  role: string;
  ipAddress?: string | null;
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
  return findEligibleUsers();
}

export async function assignManually(
  leadId: string,
  userId: string,
  actor: Actor,
): Promise<Assignment> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);

  const existing = await findAssignmentByLead(leadId);
  if (existing) {
    throw new AppError('Lead already has an active assignment', 409);
  }

  const { assignment, publishLiveSignal } = await withTransaction(async (client) => {
    await updateLeadAssignment(leadId, userId, client);
    const createdAssignment = await insertAssignment(leadId, userId, actor.id, 'manual', client);

    const notifResult = await createNotification(
      {
        recipientUserId: userId,
        occurrenceKey: `assignment:${createdAssignment.id}`,
        type: 'lead_assigned',
        title: 'New lead assigned',
        message: `${lead.business_name ?? 'A lead'} was assigned to you.`,
        metadata: { leadId },
      },
      client,
    );

    if (!notifResult.ok) {
      logger.error('Failed to persist manual assignment notification', {
        leadId,
        assignmentId: createdAssignment.id,
        error: notifResult.error.message,
      });
      throw notifResult.error;
    }

    return {
      assignment: createdAssignment,
      publishLiveSignal: notifResult.value.publishLiveSignal,
    };
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'assignment.manual',
    entityType: 'assignment',
    entityId: assignment.id,
    newValue: { lead_id: leadId, assigned_to: userId },
    ipAddress: actor.ipAddress ?? null,
  });

  if (publishLiveSignal) {
    void publishLiveSignal();
  }

  return assignment;
}

export async function overrideAssignment(
  leadId: string,
  newUserId: string,
  reason: string,
  actor: Actor,
): Promise<Assignment> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);

  const { assignment, publishLiveSignal } = await withTransaction(async (client) => {
    await updateLeadAssignment(leadId, newUserId, client);
    const createdAssignment = await insertAssignment(
      leadId,
      newUserId,
      actor.id,
      'override',
      client,
    );

    const notifResult = await createNotification(
      {
        recipientUserId: newUserId,
        occurrenceKey: `assignment:${createdAssignment.id}`,
        type: 'lead_assigned',
        title: 'New lead assigned',
        message: `${lead.business_name ?? 'A lead'} was reassigned to you.`,
        metadata: { leadId },
      },
      client,
    );

    if (!notifResult.ok) {
      logger.error('Failed to persist reassignment notification', {
        leadId,
        assignmentId: createdAssignment.id,
        error: notifResult.error.message,
      });
      throw notifResult.error;
    }

    return {
      assignment: createdAssignment,
      publishLiveSignal: notifResult.value.publishLiveSignal,
    };
  });

  await writeAuditLog({
    userId: actor.id,
    action: 'assignment.override',
    entityType: 'assignment',
    entityId: assignment.id,
    newValue: { lead_id: leadId, new_user_id: newUserId, reason },
    ipAddress: actor.ipAddress ?? null,
  });

  if (publishLiveSignal) {
    void publishLiveSignal();
  }

  return assignment;
}

export async function autoAssignLead(leadId: string): Promise<Assignment | null> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);

  const config = await findAssignmentConfig();
  if (!config || !config.is_enabled) {
    return null;
  }

  const nextUser = await getNextRoundRobinUser();
  if (!nextUser) {
    return null;
  }

  await updateLeadAssignment(leadId, nextUser.id);
  const assignment = await insertAssignment(leadId, nextUser.id, 'system', 'round_robin');

  return assignment;
}

export async function getUserAssignments(userId: string): Promise<Assignment[]> {
  return findAssignmentsByUser(userId);
}
