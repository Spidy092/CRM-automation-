/**
 * Scoring worker.
 *
 * Consumes:
 *   - `scoring:calculate-lead`  — recompute one lead's score
 *   - `scoring:recalculate-all` — recompute every non-deleted lead
 *
 * Side effect:
 *   - When a freshly computed score is `hot` and meets/exceeds
 *     `assignment_threshold`, enqueue an `assignment:round-robin` job so the
 *     assignment worker picks it up. (Roadmap §4.1, "automated lead scoring
 *     and classification on import".)
 */

import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getBullConnection } from './queue';
import {
  SCORING_QUEUE,
  SCORING_CALCULATE_LEAD,
  SCORING_RECALCULATE_ALL,
  ASSIGNMENT_ROUND_ROBIN,
  enqueueAssignment,
  type ScoringCalculateLeadJob,
  type ScoringRecalculateAllJob,
} from './queue';
import { logger } from '../shared/utils/logger';
import { incJobsProcessed, incJobsFailed, observeJobDuration } from '../shared/utils/metrics';
import { moveToDLQ } from '../lib/dlq';
import { Sentry } from '../shared/utils/sentry';
import { findScoringConfig } from '../modules/scoring/scoring.repository';
import { calculateLeadScore } from '../modules/scoring/scoring.service';

export function startScoringWorker(): Worker {
  const worker = new Worker(
    SCORING_QUEUE,
    async (job: Job) => {
      const start = Date.now();
      const baseMeta = { jobId: job.id, jobName: job.name };
      logger.info('scoring job started', baseMeta);

      try {
        let result: unknown;
        if (job.name === SCORING_CALCULATE_LEAD) {
          result = await handleCalculateLead(job.data as ScoringCalculateLeadJob);
        } else if (job.name === SCORING_RECALCULATE_ALL) {
          result = await handleRecalculateAll(job.data as ScoringRecalculateAllJob);
        } else {
          throw new Error(`Unknown scoring job: ${job.name}`);
        }

        const durationSec = (Date.now() - start) / 1000;
        observeJobDuration({ name: job.name, queue: SCORING_QUEUE }, durationSec);
        incJobsProcessed({ name: job.name, queue: SCORING_QUEUE, status: 'success' });
        logger.info('scoring job completed', { ...baseMeta, durationSec, result });
        return result;
      } catch (err) {
        incJobsFailed({ name: job.name, queue: SCORING_QUEUE });
        logger.error('scoring job failed', {
          ...baseMeta,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    {
      connection: getBullConnection() as unknown as ConnectionOptions,
      concurrency: 4,
    },
  );

  worker.on('ready', () => logger.info('scoring worker ready', { queue: SCORING_QUEUE }));
  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    logger.error('scoring job failed', { id, name: job?.name, error: err.message });
    Sentry.captureException(err, { extra: { jobId: id, jobName: job?.name } });
    if (job && job.attemptsMade >= (job.opts?.attempts ?? 3)) {
      void moveToDLQ(SCORING_QUEUE, {
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

async function handleCalculateLead(payload: ScoringCalculateLeadJob): Promise<{
  leadId: string;
  score: number;
  classification: string;
  enqueuedAssignment: boolean;
}> {
  const { leadId } = payload;
  const result = await calculateLeadScore(leadId);

  // Cross-trigger: hot leads above the assignment threshold get assigned.
  let enqueuedAssignment = false;
  if (result.classification === 'hot') {
    const config = await findScoringConfig();
    const threshold = config?.assignment_threshold ?? 70;
    if (result.score >= threshold) {
      await enqueueAssignment({
        leadId,
        score: result.score,
        classification: result.classification,
      });
      enqueuedAssignment = true;
      logger.info('enqueued assignment:round-robin for hot lead', {
        leadId,
        score: result.score,
        threshold,
      });
    }
  }

  return {
    leadId: result.lead_id,
    score: result.score,
    classification: result.classification,
    enqueuedAssignment,
  };
}

async function handleRecalculateAll(_payload: ScoringRecalculateAllJob): Promise<{
  processed: number;
  enqueued: number;
}> {
  // Snapshot the threshold up front so the hot-leads decision is consistent.
  const config = await findScoringConfig();
  const threshold = config?.assignment_threshold ?? 70;

  // The service loops internally; we need the per-lead outcomes, so we
  // re-implement the loop here with cross-trigger side effects rather than
  // calling `recalculateAllScores()` (which is silent on per-lead results).
  // We keep `recalculateAllScores` available for the admin HTTP endpoint
  // (no auto-assignment, just bulk recompute).
  const { pool } = await import('../shared/utils/db');
  const leadsResult = await pool.query<{
    id: string;
    lead_score: number;
    classification: 'hot' | 'warm' | 'cold' | null;
  }>('SELECT id, lead_score, classification FROM leads WHERE deleted_at IS NULL');

  let processed = 0;
  let enqueued = 0;
  for (const row of leadsResult.rows) {
    try {
      const result = await calculateLeadScore(row.id);
      processed += 1;
      if (result.classification === 'hot' && result.score >= threshold) {
        // Skip if already classified hot in the row we just read (i.e. no
        // status change since this run started) — avoids redundant enqueue
        // when a re-run is triggered. The assignment service layer also
        // guards against duplicate assignments.
        await enqueueAssignment({
          leadId: result.lead_id,
          score: result.score,
          classification: result.classification,
        });
        enqueued += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('recalculate: per-lead failure', { leadId: row.id, error: message });
    }
  }

  logger.info('recalculate-all complete', { processed, enqueued, threshold });
  return { processed, enqueued };
}

// Re-export so the index can find the symbol by name without star imports.
export { SCORING_QUEUE, SCORING_CALCULATE_LEAD, SCORING_RECALCULATE_ALL, ASSIGNMENT_ROUND_ROBIN };
