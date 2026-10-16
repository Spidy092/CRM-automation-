/**
 * Campaign recovery scheduler.
 *
 * Republishes durable scheduling intents lost to queue publication failures
 * or worker interruptions, and converts expired dispatch leases into
 * explicit uncertain outcomes for review. Runs on a bounded interval (one
 * minute by default); every sweep is a bounded batch, never a queue-wide
 * scan. Inactive while the rollout flag is off.
 */
import { logger } from '../shared/utils/logger';
import { isCampaignOperationsV2Enabled } from '../modules/campaigns/campaigns.rollout';
import { sweepRecovery } from '../modules/campaigns/campaigns.execution.service';

export const DEFAULT_RECOVERY_INTERVAL_MS = 60_000;

let recoveryScheduler: NodeJS.Timeout | null = null;

export async function runCampaignRecoverySweep(limit = 100): Promise<{
  republished: number;
  uncertain: number;
}> {
  if (!isCampaignOperationsV2Enabled()) return { republished: 0, uncertain: 0 };
  try {
    const result = await sweepRecovery({ limit, workerId: `campaign-recovery-${process.pid}` });
    if (result.republished > 0 || result.uncertain > 0) {
      logger.info('campaign recovery sweep completed', result);
    }
    return result;
  } catch (error) {
    logger.error('campaign recovery sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { republished: 0, uncertain: 0 };
  }
}

export function startCampaignRecoveryScheduler(
  intervalMs = DEFAULT_RECOVERY_INTERVAL_MS,
): NodeJS.Timeout {
  if (recoveryScheduler) return recoveryScheduler;
  const tick = (): void => {
    void runCampaignRecoverySweep();
  };
  tick();
  recoveryScheduler = setInterval(tick, intervalMs);
  recoveryScheduler.unref();
  return recoveryScheduler;
}

/** Test helper — releases the interval without touching workers. */
export function _resetCampaignRecoverySchedulerForTests(): void {
  if (recoveryScheduler) clearInterval(recoveryScheduler);
  recoveryScheduler = null;
}
