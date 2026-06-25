/**
 * Prometheus metrics for the CRM platform.
 *
 * Metrics exported:
 *   - crm_jobs_processed_total   Counter  — per (name, queue, status)
 *   - crm_jobs_failed_total      Counter  — per (name, queue)
 *   - crm_job_duration_seconds   Histogram — per (name, queue), buckets 0.1s–60s
 */
import { Counter, Histogram, register } from 'prom-client';

// ── Counters ───────────────────────────────────────────────────────────────

export const jobsProcessedTotal = new Counter({
  name: 'crm_jobs_processed_total',
  help: 'Total number of BullMQ jobs processed (success or fail)',
  labelNames: ['name', 'queue', 'status'] as const,
});

export const jobsFailedTotal = new Counter({
  name: 'crm_jobs_failed_total',
  help: 'Total number of BullMQ jobs that failed',
  labelNames: ['name', 'queue'] as const,
});

// ── Histograms ─────────────────────────────────────────────────────────────

export const jobDurationSeconds = new Histogram({
  name: 'crm_job_duration_seconds',
  help: 'Duration of BullMQ job processing in seconds',
  labelNames: ['name', 'queue'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

// ── Convenience Helpers ────────────────────────────────────────────────────

export function incJobsProcessed(labels: { name: string; queue: string; status: string }): void {
  jobsProcessedTotal.inc(labels);
}

export function incJobsFailed(labels: { name: string; queue: string }): void {
  jobsFailedTotal.inc(labels);
}

export function observeJobDuration(
  labels: { name: string; queue: string },
  durationSec: number,
): void {
  jobDurationSeconds.observe(labels, durationSec);
}

export { register };
