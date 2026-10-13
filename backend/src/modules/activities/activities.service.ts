import { AppError } from '../../shared/middleware/errorHandler';
import { findLeadById } from '../leads/leads.repository';
import { assertAccess, getLeadById } from '../leads/leads.service';
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
  findActivityById,
  findActivityAuthors,
  insertActivity,
  setActivityPinned as repoSetActivityPinned,
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
  const {
    limit,
    offset,
    type,
    cursorTs,
    cursorId,
    search,
    authorId,
    dateFrom,
    dateTo,
    pinnedOnly,
  } = filters;
  return findActivitiesByLeadId({
    leadId,
    limit,
    offset,
    type,
    cursorTs,
    cursorId,
    search,
    authorId,
    dateFrom,
    dateTo,
    pinnedOnly,
  });
}

/**
 * Pins or unpins a note on a lead. Only `note` activities can be pinned —
 * system events (status/assignment changes) stay unpinnable so the timeline
 * cannot be reordered around automated history. Write access follows the same
 * ownership rule as creating notes (sales reps: own leads only); the route
 * layer additionally restricts this to admin/manager/sales.
 */
export async function setNotePinned(
  leadId: string,
  activityId: string,
  pinned: boolean,
  actor: Actor,
): Promise<import('./activities.types').ActivityWithUser> {
  const lead = await findLeadById(leadId);
  if (!lead) throw new AppError('Lead not found', 404);
  assertAccess(lead.assigned_to, actor, true);
  const activity = await findActivityById(activityId);
  if (!activity || activity.lead_id !== leadId) throw new AppError('Activity not found', 404);
  if (activity.type !== 'note') {
    throw new AppError('Only notes can be pinned', 422);
  }
  const updated = await repoSetActivityPinned(activityId, pinned, actor.id);
  if (!updated) throw new AppError('Activity not found', 404);
  return updated;
}

export async function listActivityAuthors(
  leadId: string,
  actor: Actor,
): Promise<import('./activities.schema').ActivityAuthor[]> {
  await getLeadById(leadId, actor);
  return findActivityAuthors(leadId);
}
