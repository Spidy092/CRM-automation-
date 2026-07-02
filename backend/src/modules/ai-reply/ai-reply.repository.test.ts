import { pool, queryOne } from '../../shared/utils/db';
import {
  appendObjectionToProfile as appendObjectionToProfileRepo,
  appendBuyingSignalToProfile as appendBuyingSignalToProfileRepo,
  updateNextBestAction,
} from '../ai-intelligence/ai-intelligence.repository';
import {
  upsertConversationSummary,
  appendObjectionToProfile,
  appendBuyingSignalToProfile,
  updateProfileNextAction,
  getLeadCampaignContext,
} from './ai-reply.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));

jest.mock('../ai-intelligence/ai-intelligence.repository', () => ({
  appendObjectionToProfile: jest.fn(),
  appendBuyingSignalToProfile: jest.fn(),
  updateNextBestAction: jest.fn(),
}));

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedPoolQuery = pool.query as jest.Mock;

const leadId = '019f079c-f429-762a-89ab-d143218efd4e';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('upsertConversationSummary', () => {
  it('inserts or updates conversation summary', async () => {
    mockedPoolQuery.mockResolvedValue({ rowCount: 1 });

    await upsertConversationSummary(leadId, 'Summary text', 'interested', 'positive');

    expect(mockedPoolQuery).toHaveBeenCalledTimes(1);
    const sql = mockedPoolQuery.mock.calls[0][0] as string;
    const params = mockedPoolQuery.mock.calls[0][1] as unknown[];
    expect(sql).toContain('INSERT INTO lead_conversation_summaries');
    expect(sql).toContain('ON CONFLICT (lead_id) DO UPDATE SET');
    expect(params[0]).toBe(leadId);
    expect(params[1]).toBe('Summary text');
    expect(params[2]).toBe('interested');
    expect(params[3]).toBe('positive');
  });
});

describe('appendObjectionToProfile', () => {
  it('appends a JSONB objection entry to the profile', async () => {
    (appendObjectionToProfileRepo as jest.Mock).mockResolvedValue(undefined);

    await appendObjectionToProfile(leadId, 'price', 'It is too expensive.');

    expect(appendObjectionToProfileRepo).toHaveBeenCalledWith(leadId, 'price', 'It is too expensive.');
  });
});

describe('appendBuyingSignalToProfile', () => {
  it('appends a JSONB buying signal entry to the profile', async () => {
    (appendBuyingSignalToProfileRepo as jest.Mock).mockResolvedValue(undefined);

    await appendBuyingSignalToProfile(leadId, 'asked for pricing');

    expect(appendBuyingSignalToProfileRepo).toHaveBeenCalledWith(leadId, 'asked for pricing');
  });
});

describe('updateProfileNextAction', () => {
  it('updates next best action fields on the profile', async () => {
    (updateNextBestAction as jest.Mock).mockResolvedValue({} as any);

    await updateProfileNextAction(leadId, 'schedule_call', 'Lead wants a demo', 92);

    expect(updateNextBestAction).toHaveBeenCalledWith(leadId, 'schedule_call', 'Lead wants a demo', 92);
  });
});

describe('getLeadCampaignContext', () => {
  it('returns campaign context when lead and active campaign exist', async () => {
    mockedQueryOne.mockResolvedValue({
      assigned_to: 'user-1',
      campaign_id: 'campaign-1',
      autonomy_level: 'autopilot',
      ai_min_confidence: 60,
    });

    const result = await getLeadCampaignContext(leadId);

    expect(result).toEqual({
      assignedTo: 'user-1',
      campaignId: 'campaign-1',
      autonomyLevel: 'autopilot',
      aiMinConfidence: 60,
    });
    const sql = mockedQueryOne.mock.calls[0][0] as string;
    expect(sql).toContain('FROM leads l');
    expect(sql).toContain('LEFT JOIN campaign_leads cl');
    expect(sql).toContain('LEFT JOIN campaigns c');
    expect(sql).toContain('c.status = \'active\'');
    expect(sql).toContain('ORDER BY c.ai_min_confidence ASC NULLS LAST');
  });

  it('returns null when no row is found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await getLeadCampaignContext(leadId);

    expect(result).toBeNull();
  });

  it('defaults autonomy level to guarded and confidence to 70 when null', async () => {
    mockedQueryOne.mockResolvedValue({
      assigned_to: null,
      campaign_id: null,
      autonomy_level: null,
      ai_min_confidence: null,
    });

    const result = await getLeadCampaignContext(leadId);

    expect(result).toEqual({
      assignedTo: null,
      campaignId: null,
      autonomyLevel: 'guarded',
      aiMinConfidence: 70,
    });
  });
});
