import { AppError } from '../../shared/middleware/errorHandler';
import { findLeadById } from '../leads/leads.repository';
import { assertAccess } from '../leads/leads.service';
import {
  Activity,
  Actor,
  ActivityListFilters,
  ActivityListResult,
  ActivityType,
} from './activities.types';
import {
  createOutboundActivityAndUpdateLead,
  findActivitiesByLeadId,
  insertActivity,
} from './activities.repository';

export async function createManualActivity(
  leadId: string,
  userId: string,
  type: ActivityType,
  metadata: Record<string, unknown> | undefined,
): Promise<Activity> {
  if (type === 'status_change' || type === 'assignment_change') {
    throw new AppError(
      `Activity type ${type} cannot be created manually; it is logged automatically`,
      422,
    );
  }
  return insertActivity({ lead_id: leadId, user_id: userId, type, metadata });
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

export async function logStatusChangeActivity(
  leadId: string,
  userId: string,
  field: 'pipeline_stage_id' | 'status',
  fromValue: string | null,
  toValue: string | null,
): Promise<Activity> {
  return insertActivity({
    lead_id: leadId,
    user_id: userId,
    type: 'status_change',
    metadata: { field, from: fromValue, to: toValue },
  });
}

export async function logAssignmentChangeActivity(
  leadId: string,
  userId: string,
  fromUserId: string | null,
  toUserId: string | null,
): Promise<Activity> {
  return insertActivity({
    lead_id: leadId,
    user_id: userId,
    type: 'assignment_change',
    metadata: { from: fromUserId, to: toUserId },
  });
}

export async function listActivities(
  leadId: string,
  actor: Actor,
  filters: Omit<ActivityListFilters, 'leadId'>,
): Promise<ActivityListResult> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);
  assertAccess(lead.assigned_to, actor, false);
  const { limit, offset, type } = filters;
  return findActivitiesByLeadId({ leadId, limit, offset, type });
}
