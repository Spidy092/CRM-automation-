import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { findLeadById } from '../leads/leads.repository';
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

  await updateLeadAssignment(leadId, userId);
  const assignment = await insertAssignment(leadId, userId, actor.id, 'manual');

  await writeAuditLog({
    userId: actor.id,
    action: 'assignment.manual',
    entityType: 'assignment',
    entityId: assignment.id,
    newValue: { lead_id: leadId, assigned_to: userId },
    ipAddress: actor.ipAddress ?? null,
  });

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

  await updateLeadAssignment(leadId, newUserId);
  const assignment = await insertAssignment(leadId, newUserId, actor.id, 'override');

  await writeAuditLog({
    userId: actor.id,
    action: 'assignment.override',
    entityType: 'assignment',
    entityId: assignment.id,
    newValue: { lead_id: leadId, new_user_id: newUserId, reason },
    ipAddress: actor.ipAddress ?? null,
  });

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
