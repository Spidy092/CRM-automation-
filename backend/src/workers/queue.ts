/**
 * Shared BullMQ queue + connection helpers.
 *
 * Queues:
 *   - `scoring:calculate-lead`  — recompute a single lead's score
 *   - `scoring:recalculate-all` — recompute every non-deleted lead
 *   - `assignment:round-robin` — round-robin-assign a lead to a sales rep
 *
 * Jobs are typed via `JobData` so payloads are checked at the queue boundary.
 *
 * Sprint 2 scope:
 *   - The scoring worker enqueues an `assignment:round-robin` job after a
 *     `hot` classification (per the roadmap's "auto-classification →
 *     assignment" sequence).
 *   - The assignment worker calls the assignments service layer to perform
 *     the assignment and then dispatches a Slack/Teams notification.
 */

import IORedis, { type Redis } from 'ioredis';
import { Queue, type ConnectionOptions } from 'bullmq';
import { logger } from '../shared/utils/logger';

export const SCORING_CALCULATE_LEAD = 'scoring:calculate-lead';
export const SCORING_RECALCULATE_ALL = 'scoring:recalculate-all';
export const ASSIGNMENT_ROUND_ROBIN = 'assignment:round-robin';

export const SCORING_QUEUE = 'scoring';
export const ASSIGNMENT_QUEUE = 'assignment';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connection that backs
 * the workers. The shared `redis` client in `shared/utils/redis` is configured
 * with `maxRetriesPerRequest: 3` for use by the API. We therefore create a
 * dedicated connection for queue producers and worker consumers.
 *
 * BullMQ bundles its own copy of ioredis; the types are nominally distinct
 * even though they describe the same object. We cast through `unknown` so
 * the project keeps a single ioredis dependency in `package.json`.
 */
let bullConnection: Redis | null = null;

export function getBullConnection(): Redis {
  if (bullConnection) return bullConnection;
  bullConnection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  bullConnection.on('error', (err: Error) => {
    logger.error('BullMQ Redis connection error', { error: err.message });
  });
  return bullConnection;
}

const connectionOpts = getBullConnection() as unknown as ConnectionOptions;

export const scoringQueue = new Queue(SCORING_QUEUE, {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
    removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
  },
});

export const assignmentQueue = new Queue(ASSIGNMENT_QUEUE, {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
    removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
  },
});

// ── Job payload types ──────────────────────────────────────────────────────

export interface ScoringCalculateLeadJob {
  leadId: string;
}

export interface ScoringRecalculateAllJob {
  /** Optional soft cap for batch runs; undefined = process all leads. */
  limit?: number;
}

export interface AssignmentRoundRobinJob {
  leadId: string;
  /** Score + classification captured at enqueue time so the worker can decide
   *  whether to re-validate against `assignment_threshold` even if config
   *  changes between enqueue and process. */
  score: number;
  classification: 'hot' | 'warm' | 'cold';
}

export type JobData =
  | { name: typeof SCORING_CALCULATE_LEAD; data: ScoringCalculateLeadJob }
  | { name: typeof SCORING_RECALCULATE_ALL; data: ScoringRecalculateAllJob }
  | { name: typeof ASSIGNMENT_ROUND_ROBIN; data: AssignmentRoundRobinJob };

/**
 * Enqueue a round-robin assignment for a lead. Idempotent: callers should not
 * enqueue if the lead already has an active assignment (enforced in the
 * service layer as a defence in depth).
 */
export async function enqueueAssignment(payload: AssignmentRoundRobinJob): Promise<void> {
  await assignmentQueue.add(ASSIGNMENT_ROUND_ROBIN, payload);
}

/** Test helper — does not call Redis. */
export function _resetBullConnectionForTests(): void {
  bullConnection = null;
}
