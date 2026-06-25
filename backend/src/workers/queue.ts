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

// Sprint 3 — Outreach
export const OUTREACH_DISPATCH = 'outreach:dispatch-step';
export const OUTREACH_FOLLOW_UP = 'outreach:schedule-follow-up';
export const OUTREACH_STOP_CHECK = 'outreach:check-stop-condition';

export const OUTREACH_QUEUE = 'outreach';

// Report Export
export const REPORT_EXPORT = 'report:export';
export const REPORTS_QUEUE = 'reports';

// Scraper
export const SCRAPER_RUN = 'scraper:run';
export const SCRAPER_QUEUE = 'scraper';

// Lead Events (automation triggers)
export const LEAD_EVENT = 'lead:event';
export const LEAD_EVENTS_QUEUE = 'lead-events';

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

export const reportsQueue = new Queue(REPORTS_QUEUE, {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
    removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
  },
});

export const scraperQueue = new Queue(SCRAPER_QUEUE, {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1_000, age: 24 * 60 * 60 },
    removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
  },
});

export const leadEventsQueue = new Queue(LEAD_EVENTS_QUEUE, {
  connection: connectionOpts,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { count: 2_000, age: 24 * 60 * 60 },
    removeOnFail: { count: 500, age: 7 * 24 * 60 * 60 },
  },
});

export const outreachQueue = new Queue(OUTREACH_QUEUE, {
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

// ── Sprint 3 Outreach Job Payloads ──────────────────────────────────────────

// ── Report Export Job Payload ─────────────────────────────────────────────

export interface ReportExportJob {
  reportType: string;
  format: 'csv' | 'xlsx' | 'pdf';
  filters?: Record<string, unknown>;
  actorId: string;
  actorRole: string;
}

export interface OutreachDispatchJob {
  leadId: string;
  campaignId: string;
  sequenceId: string;
  stepNumber: number;
  channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
  templateId: string;
  /** If true, the worker simulates a successful dispatch without calling
   *  live APIs (for Sprint 3 pre-credential testing). */
  mockMode: boolean;
  aiPersonalizationEnabled?: boolean;
}

export interface OutreachFollowUpJob {
  leadId: string;
  campaignId: string;
  sequenceId: string;
  previousStepNumber: number;
  nextStepNumber: number;
  delayHours: number;
  mockMode: boolean;
  aiPersonalizationEnabled?: boolean;
}

export interface ScraperRunJob {
  configId: string;
  triggeredBy: string;
}

export type LeadEventType =
  | 'lead.created'
  | 'lead.scored'
  | 'lead.stage_moved'
  | 'lead.assigned'
  | 'lead.status_changed';

export interface LeadEventJob {
  event: LeadEventType;
  leadId: string;
  payload: Record<string, unknown>;
}

export interface OutreachStopCheckJob {
  leadId: string;
  campaignId: string;
  /** Stop rules to evaluate (e.g. max_messages, replied, opted_out). */
  rules: Array<{
    type: 'max_messages' | 'replied' | 'opted_out' | 'paused' | 'won' | 'lost' | 'no_engagement';
    value?: unknown;
  }>;
}

export type JobData =
  | { name: typeof SCORING_CALCULATE_LEAD; data: ScoringCalculateLeadJob }
  | { name: typeof SCORING_RECALCULATE_ALL; data: ScoringRecalculateAllJob }
  | { name: typeof ASSIGNMENT_ROUND_ROBIN; data: AssignmentRoundRobinJob }
  | { name: typeof OUTREACH_DISPATCH; data: OutreachDispatchJob }
  | { name: typeof OUTREACH_FOLLOW_UP; data: OutreachFollowUpJob }
  | { name: typeof OUTREACH_STOP_CHECK; data: OutreachStopCheckJob }
  | { name: typeof REPORT_EXPORT; data: ReportExportJob }
  | { name: typeof SCRAPER_RUN; data: ScraperRunJob };

/**
 * Enqueue a round-robin assignment for a lead. Idempotent: callers should not
 * enqueue if the lead already has an active assignment (enforced in the
 * service layer as a defence in depth).
 */
export async function enqueueAssignment(payload: AssignmentRoundRobinJob): Promise<void> {
  await assignmentQueue.add(ASSIGNMENT_ROUND_ROBIN, payload);
}

// ── Sprint 3 Outreach Enqueue Helpers ──────────────────────────────────────

export async function enqueueReportExport(payload: ReportExportJob): Promise<string> {
  const job = await reportsQueue.add(REPORT_EXPORT, payload);
  return job.id as string;
}

function outreachJobId(
  kind: 'dispatch' | 'follow-up' | 'stop-check',
  payload: { campaignId: string; leadId: string; stepNumber?: number; nextStepNumber?: number },
): string {
  const step = payload.stepNumber ?? payload.nextStepNumber ?? 0;
  return `outreach:${kind}:${payload.campaignId}:${payload.leadId}:step:${step}`;
}

export async function enqueueOutreachDispatch(payload: OutreachDispatchJob): Promise<void> {
  await outreachQueue.add(OUTREACH_DISPATCH, payload, {
    jobId: outreachJobId('dispatch', payload),
  });
}

export async function enqueueOutreachFollowUp(payload: OutreachFollowUpJob): Promise<void> {
  await outreachQueue.add(OUTREACH_FOLLOW_UP, payload, {
    delay: payload.delayHours * 60 * 60 * 1000,
    jobId: outreachJobId('follow-up', payload),
  });
}

export async function enqueueScraperRun(payload: ScraperRunJob): Promise<string> {
  const job = await scraperQueue.add(SCRAPER_RUN, payload);
  return job.id as string;
}

export async function enqueueLeadEvent(payload: LeadEventJob): Promise<void> {
  await leadEventsQueue.add(LEAD_EVENT, payload);
}

export async function enqueueOutreachStopCheck(payload: OutreachStopCheckJob): Promise<void> {
  await outreachQueue.add(OUTREACH_STOP_CHECK, payload, {
    jobId: outreachJobId('stop-check', payload),
  });
}

export async function cancelPendingOutreachJobs(filter: {
  leadId?: string;
  campaignId?: string;
}): Promise<number> {
  const jobs = await outreachQueue.getJobs(['waiting', 'delayed', 'prioritized', 'waiting-children']);
  let removed = 0;
  for (const job of jobs) {
    const data = job.data as Partial<OutreachDispatchJob & OutreachFollowUpJob & OutreachStopCheckJob>;
    if (filter.leadId && data.leadId !== filter.leadId) continue;
    if (filter.campaignId && data.campaignId !== filter.campaignId) continue;
    try {
      await job.remove();
      removed += 1;
    } catch (err) {
      logger.warn('Failed to remove pending outreach job', {
        jobId: job.id,
        leadId: data.leadId,
        campaignId: data.campaignId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return removed;
}

/** Test helper — does not call Redis. */
export function _resetBullConnectionForTests(): void {
  bullConnection = null;
}
