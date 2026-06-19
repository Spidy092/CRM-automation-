/**
 * Assignment worker.
 *
 * Consumes:
 *   - `assignment:round-robin` — assign a single lead to a sales rep via
 *     the round-robin engine. The service layer enforces the threshold
 *     against current `assignment_config` and refuses to assign when no
 *     eligible users are available. After a successful assignment, the
 *     worker dispatches a Slack/Teams notification.
 */

import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection } from './queue';
import { ASSIGNMENT_QUEUE, ASSIGNMENT_ROUND_ROBIN, type AssignmentRoundRobinJob } from './queue';
import { logger } from '../shared/utils/logger';
import { autoAssignLead } from '../modules/assignments/assignments.service';
import { findEligibleUsers } from '../modules/assignments/assignments.repository';
import { findLeadById } from '../modules/leads/leads.repository';
import { notifyAssignment } from '../modules/integrations/notifications';

export function startAssignmentWorker(): Worker {
  const worker = new Worker(
    ASSIGNMENT_QUEUE,
    async (job: Job) => {
      if (job.name === ASSIGNMENT_ROUND_ROBIN) {
        return handleRoundRobin(job.data as AssignmentRoundRobinJob);
      }
      throw new Error(`Unknown assignment job: ${job.name}`);
    },
    {
      connection: getBullConnection() as unknown as ConnectionOptions,
      concurrency: 2,
    },
  );

  worker.on('ready', () => logger.info('assignment worker ready', { queue: ASSIGNMENT_QUEUE }));
  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    logger.error('assignment job failed', { id, name: job?.name, error: err.message });
  });
  worker.on('completed', (job, result: unknown) => {
    logger.info('assignment job completed', { id: job.id, name: job.name, result });
  });

  return worker;
}

async function handleRoundRobin(payload: AssignmentRoundRobinJob): Promise<{
  leadId: string;
  assigned: boolean;
  assignedTo?: string;
  notified: boolean;
}> {
  const { leadId } = payload;

  // Re-check eligibility: the threshold or eligible user list may have changed
  // since the job was enqueued.
  const eligible = await findEligibleUsers();
  if (eligible.length === 0) {
    logger.warn('no eligible users for round-robin assignment; skipping', { leadId });
    return { leadId, assigned: false, notified: false };
  }

  const assignment = await autoAssignLead(leadId);
  if (!assignment) {
    // Service refused — e.g. config disabled, threshold not met, or a prior
    // assignment exists. Not an error; just log at info.
    logger.info('autoAssignLead returned null', { leadId, score: payload.score });
    return { leadId, assigned: false, notified: false };
  }

  // Build a friendly notification payload. Fetch the lead for the business
  // name; failure here should never block assignment success.
  let businessName: string | null = null;
  try {
    const lead = await findLeadById(leadId);
    businessName = lead?.business_name ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('failed to load lead for notification context', { leadId, error: message });
  }

  let notified = false;
  try {
    await notifyAssignment({
      leadId,
      leadName: businessName,
      assignedTo: assignment.assigned_to,
      assignedBy: assignment.assigned_by,
      score: payload.score,
      classification: payload.classification,
    });
    notified = true;
  } catch (err) {
    // notifyAssignment already swallows transport errors internally; if it
    // rethrows we still don't want to fail the assignment.
    const message = err instanceof Error ? err.message : String(err);
    logger.error('notifyAssignment threw unexpectedly', { leadId, error: message });
  }

  return { leadId, assigned: true, assignedTo: assignment.assigned_to, notified };
}

export { ASSIGNMENT_QUEUE, ASSIGNMENT_ROUND_ROBIN };
