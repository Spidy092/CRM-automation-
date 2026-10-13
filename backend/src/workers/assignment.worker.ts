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
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { autoAssignLead, getEligibleUsers } from '../modules/assignments/assignments.service';
import { findLeadById } from '../modules/leads/leads.repository';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { notifyAssignment } from '../modules/integrations/notifications';

export function startAssignmentWorker(): Worker {
  const worker = new Worker(
    ASSIGNMENT_QUEUE,
    async (job: Job) => {
      const start = Date.now();
      const baseMeta = { jobId: job.id, jobName: job.name };
      logger.info('assignment job started', baseMeta);

      try {
        let result: unknown;
        if (job.name === ASSIGNMENT_ROUND_ROBIN) {
          result = await handleRoundRobin(job.data as AssignmentRoundRobinJob);
        } else {
          throw new Error(`Unknown assignment job: ${job.name}`);
        }

        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: job.name, queue: ASSIGNMENT_QUEUE }, durationSec);
        incJobsProcessed({ name: job.name, queue: ASSIGNMENT_QUEUE, status: 'success' });
        logger.info('assignment job completed', { ...baseMeta, durationSec, result });
        return result;
      } catch (err) {
        incJobsFailed({ name: job.name, queue: ASSIGNMENT_QUEUE });
        logger.error('assignment job failed', {
          ...baseMeta,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
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
    Sentry.captureException(err, { extra: { jobId: id, jobName: job?.name } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(ASSIGNMENT_QUEUE, {
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
      });
    }
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
  // since the job was enqueued. Roles come from live config so an edited
  // eligible_roles set takes effect without redeploying.
  const eligible = await getEligibleUsers();
  if (eligible.length === 0) {
    logger.warn('no eligible users for round-robin assignment; skipping', { leadId });
    return { leadId, assigned: false, notified: false };
  }

  // The service owns the transaction (lead lock → recipient revalidation →
  // owner write → history + durable notification) and publishes post-commit
  // effects once. A null return is a safe no-op: duplicate delivery or a
  // lead already taken manually since enqueue.
  const result = await autoAssignLead(leadId, {
    score: payload.score,
    classification: payload.classification,
  });
  if (!result) {
    logger.info('autoAssignLead returned null', { leadId, score: payload.score });
    return { leadId, assigned: false, notified: false };
  }
  const { assignment } = result;

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
      // External display string only; the durable row stores null for
      // system-originated assignments (UUID FK column).
      assignedBy: assignment.assigned_by ?? 'system',
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
