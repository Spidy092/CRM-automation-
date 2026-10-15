/**
 * Rollout flag for the campaign operations execution model (phases 1–2).
 *
 * When disabled (default), campaigns use the legacy BullMQ-only scheduling
 * path. When enabled, new scheduling intents are persisted in PostgreSQL and
 * a single scheduling owner dispatches for each enrollment — legacy and new
 * senders are never active for the same enrollment at the same time.
 *
 * Default off. Set `CAMPAIGN_OPERATIONS_V2_ENABLED=true` to opt in.
 */
export function isCampaignOperationsV2Enabled(override?: boolean | null): boolean {
  if (typeof override === 'boolean') return override;
  return process.env.CAMPAIGN_OPERATIONS_V2_ENABLED === 'true';
}
