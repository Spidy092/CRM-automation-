/**
 * Prometheus metrics for the CRM platform.
 *
 * Metrics exported:
 *   - crm_jobs_processed_total            Counter  — per (name, queue, status)
 *   - crm_jobs_failed_total               Counter  — per (name, queue)
 *   - crm_job_duration_seconds            Histogram — per (name, queue)
 *   - crm_ai_research_total               Counter  — per (status)
 *   - crm_ai_research_duration_seconds    Histogram
 *   - crm_ai_openai_tokens_total          Counter  — per (decision_type)
 *   - crm_ai_reply_classified_total       Counter  — per (intent_class)     [Sprint 6]
 *   - crm_ai_decisions_total              Counter  — per (decision_type, autonomy_level) [Sprint 6]
 *   - crm_ai_inbox_items_total            Counter  — per (item_type, event) [Sprint 6]
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

// ── Phase 2 AI Metrics ─────────────────────────────────────────────────────

export const aiResearchTotal = new Counter({
  name: 'crm_ai_research_total',
  help: 'Total AI lead research jobs by status',
  labelNames: ['status'] as const,
});

export const aiResearchDurationSeconds = new Histogram({
  name: 'crm_ai_research_duration_seconds',
  help: 'Duration of AI lead research jobs in seconds',
  buckets: [1, 2, 5, 10, 15, 20, 30],
});

export const aiOpenaiTokensTotal = new Counter({
  name: 'crm_ai_openai_tokens_total',
  help: 'Total OpenAI tokens consumed by decision type',
  labelNames: ['decision_type'] as const,
});

export function incAiResearch(status: 'success' | 'failed' | 'skipped'): void {
  aiResearchTotal.inc({ status });
}

export function observeAiResearchDuration(durationSec: number): void {
  aiResearchDurationSeconds.observe(durationSec);
}

export function incAiTokens(decisionType: string, tokens: number): void {
  aiOpenaiTokensTotal.inc({ decision_type: decisionType }, tokens);
}

// ── Sprint 6 AI Metrics ───────────────────────────────────────────────────

export const aiReplyClassifiedTotal = new Counter({
  name: 'crm_ai_reply_classified_total',
  help: 'Inbound replies classified by intent class',
  labelNames: ['intent_class'] as const,
});

export const aiDecisionsTotal = new Counter({
  name: 'crm_ai_decisions_total',
  help: 'All AI decisions by type and autonomy level',
  labelNames: ['decision_type', 'autonomy_level'] as const,
});

export const aiInboxItemsTotal = new Counter({
  name: 'crm_ai_inbox_items_total',
  help: 'AI inbox item lifecycle events by type and event',
  labelNames: ['item_type', 'event'] as const,
});

export function incAiReplyClassified(intentClass: string): void {
  aiReplyClassifiedTotal.inc({ intent_class: intentClass });
}

export function incAiDecision(decisionType: string, autonomyLevel: string): void {
  aiDecisionsTotal.inc({ decision_type: decisionType, autonomy_level: autonomyLevel });
}

export function incAiInboxItem(itemType: string, event: string): void {
  aiInboxItemsTotal.inc({ item_type: itemType, event });
}

export { register };

// ── Agent Harness Metrics ─────────────────────────────────────────────────

export const agentActionsTotal = new Counter({
  name: 'crm_agent_actions_total',
  help: 'Agent action lifecycle events by source, action, status, and risk tier',
  labelNames: ['source', 'action', 'status', 'risk_tier'] as const,
});

export const agentActionDurationSeconds = new Histogram({
  name: 'crm_agent_action_duration_seconds',
  help: 'Agent action execution duration in seconds',
  labelNames: ['action', 'risk_tier'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
});

export function incAgentAction(labels: {
  source: string;
  action: string;
  status: string;
  riskTier: string;
}): void {
  agentActionsTotal.inc({
    source: labels.source,
    action: labels.action,
    status: labels.status,
    risk_tier: labels.riskTier,
  });
}

export function observeAgentActionDuration(labels: {
  action: string;
  riskTier: string;
}, durationSec: number): void {
  agentActionDurationSeconds.observe(
    { action: labels.action, risk_tier: labels.riskTier },
    durationSec,
  );
}
