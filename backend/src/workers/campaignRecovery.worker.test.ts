jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../modules/campaigns/campaigns.execution.service', () => ({
  sweepRecovery: jest.fn(),
}));

import { sweepRecovery } from '../modules/campaigns/campaigns.execution.service';
import {
  runCampaignRecoverySweep,
  startCampaignRecoveryScheduler,
  _resetCampaignRecoverySchedulerForTests,
} from './campaignRecovery.worker';

const originalFlag = process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;

afterEach(() => {
  _resetCampaignRecoverySchedulerForTests();
  if (originalFlag === undefined) delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
  else process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = originalFlag;
});

describe('runCampaignRecoverySweep', () => {
  it('stays inactive while the rollout flag is off', async () => {
    delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
    await expect(runCampaignRecoverySweep()).resolves.toEqual({ republished: 0, uncertain: 0 });
    expect(sweepRecovery).not.toHaveBeenCalled();
  });

  it('delegates to the execution service when enabled', async () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    (sweepRecovery as jest.Mock).mockResolvedValue({ republished: 2, uncertain: 1 });
    await expect(runCampaignRecoverySweep(50)).resolves.toEqual({ republished: 2, uncertain: 1 });
    expect(sweepRecovery).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('never throws — a failed sweep is logged and retried next tick', async () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    (sweepRecovery as jest.Mock).mockRejectedValue(new Error('DB down'));
    await expect(runCampaignRecoverySweep()).resolves.toEqual({ republished: 0, uncertain: 0 });
  });
});

describe('startCampaignRecoveryScheduler', () => {
  it('returns a single shared timer', () => {
    const first = startCampaignRecoveryScheduler(60_000);
    const second = startCampaignRecoveryScheduler(60_000);
    expect(first).toBe(second);
  });
});
