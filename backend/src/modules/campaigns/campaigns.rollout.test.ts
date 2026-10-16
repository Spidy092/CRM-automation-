import { isCampaignOperationsV2Enabled } from './campaigns.rollout';

describe('isCampaignOperationsV2Enabled', () => {
  const original = process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
    else process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = original;
  });

  it('defaults to off', () => {
    delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
    expect(isCampaignOperationsV2Enabled()).toBe(false);
  });

  it('opts in explicitly', () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    expect(isCampaignOperationsV2Enabled()).toBe(true);
  });

  it('stays off for any other value', () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = '1';
    expect(isCampaignOperationsV2Enabled()).toBe(false);
  });

  it('honors an explicit override', () => {
    delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
    expect(isCampaignOperationsV2Enabled(true)).toBe(true);
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    expect(isCampaignOperationsV2Enabled(false)).toBe(false);
  });
});
