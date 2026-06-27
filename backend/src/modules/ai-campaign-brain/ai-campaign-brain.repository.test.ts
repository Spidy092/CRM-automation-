import { pool, queryOne } from '../../shared/utils/db';
import {
  upsertCampaignBrief,
  findBriefByCampaignId,
  findCampaignBrief,
  approveBrief,
  rejectBrief,
  getCampaignLeadStats,
} from './ai-campaign-brain.repository';
import type { CampaignBrief } from './ai-campaign-brain.types';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedPoolQuery = pool.query as jest.Mock;

const makeBrief = (overrides: Partial<CampaignBrief> = {}): CampaignBrief => ({
  id: 'brief-1',
  campaign_id: 'campaign-1',
  total_leads_evaluated: 100,
  eligible_leads: 80,
  high_fit_leads: 25,
  segment_summary: 'Mid-market SaaS buyers with expansion budget',
  recommended_offer_angle: 'ROI-focused annual discount',
  expected_objections: ['Price', 'Timing', 'Competitor lock-in'],
  risk_warnings: ['Low intent in EMEA'],
  recommended_sequence: [
    { step_number: 1, channel: 'email', delay_hours: 0, goal: 'Introduce offer' },
    { step_number: 2, channel: 'whatsapp', delay_hours: 48, goal: 'Book demo' },
  ],
  template_suggestions: [
    { channel: 'email', subject: 'Quick question', body_preview: 'Hi {{name}}, ...' },
  ],
  recommended_autonomy_level: 'guarded',
  confidence_score: 0.87,
  status: 'draft',
  approved_by: null,
  approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
  ...overrides,
});

const makeUpsertInput = () => ({
  campaign_id: 'campaign-1',
  total_leads_evaluated: 100,
  eligible_leads: 80,
  high_fit_leads: 25,
  segment_summary: 'Mid-market SaaS buyers with expansion budget',
  recommended_offer_angle: 'ROI-focused annual discount',
  expected_objections: ['Price', 'Timing', 'Competitor lock-in'],
  risk_warnings: ['Low intent in EMEA'],
  recommended_sequence: [
    { step_number: 1, channel: 'email' as const, delay_hours: 0, goal: 'Introduce offer' },
    { step_number: 2, channel: 'whatsapp' as const, delay_hours: 48, goal: 'Book demo' },
  ],
  template_suggestions: [
    { channel: 'email' as const, subject: 'Quick question', body_preview: 'Hi {{name}}, ...' },
  ],
  recommended_autonomy_level: 'guarded',
  confidence_score: 0.87,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('upsertCampaignBrief', () => {
  it('inserts a new campaign brief and returns it', async () => {
    const brief = makeBrief();
    mockedQueryOne.mockResolvedValue(brief);

    const result = await upsertCampaignBrief(makeUpsertInput());

    expect(result).toEqual(brief);
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
  });

  it('updates an existing campaign brief on conflict and returns it', async () => {
    const brief = makeBrief({ high_fit_leads: 40 });
    mockedQueryOne.mockResolvedValue(brief);

    const result = await upsertCampaignBrief({
      ...makeUpsertInput(),
      high_fit_leads: 40,
    });

    expect(result).toEqual(brief);
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
  });

  it('throws when upsert returns null', async () => {
    mockedQueryOne.mockResolvedValue(null);

    await expect(upsertCampaignBrief(makeUpsertInput())).rejects.toThrow(
      'Failed to upsert campaign brief for campaign campaign-1',
    );
  });

  it('passes JSON-stringified arrays and objects to the query params', async () => {
    const brief = makeBrief();
    mockedQueryOne.mockResolvedValue(brief);
    const input = makeUpsertInput();

    await upsertCampaignBrief(input);

    const params = mockedQueryOne.mock.calls[0][1] as unknown[];
    expect(params[6]).toBe(JSON.stringify(input.expected_objections));
    expect(params[7]).toBe(JSON.stringify(input.risk_warnings));
    expect(params[8]).toBe(JSON.stringify(input.recommended_sequence));
    expect(params[9]).toBe(JSON.stringify(input.template_suggestions));
  });

  it('includes an ON CONFLICT UPDATE clause', async () => {
    mockedQueryOne.mockResolvedValue(makeBrief());

    await upsertCampaignBrief(makeUpsertInput());

    const sql = mockedQueryOne.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT (campaign_id) DO UPDATE SET');
    expect(sql).toMatch(/status\s+=\s+'draft'/);
    expect(sql).toMatch(/approved_by\s+=\s+NULL/);
  });
});

describe('findBriefByCampaignId', () => {
  it('returns the brief when found', async () => {
    const brief = makeBrief();
    mockedQueryOne.mockResolvedValue(brief);

    const result = await findBriefByCampaignId('campaign-1');

    expect(result).toEqual(brief);
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
  });

  it('returns null when not found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await findBriefByCampaignId('missing');

    expect(result).toBeNull();
  });

  it('queries by campaign_id', async () => {
    mockedQueryOne.mockResolvedValue(makeBrief());

    await findBriefByCampaignId('campaign-1');

    const sql = mockedQueryOne.mock.calls[0][0] as string;
    const params = mockedQueryOne.mock.calls[0][1] as unknown[];
    expect(sql).toContain('WHERE campaign_id = $1');
    expect(params).toEqual(['campaign-1']);
  });
});

describe('findCampaignBrief', () => {
  it('returns the latest approved brief for a campaign', async () => {
    const brief = makeBrief({ status: 'approved', approved_by: 'manager-1', approved_at: '2026-06-26T11:00:00.000Z' });
    mockedQueryOne.mockResolvedValue(brief);

    const result = await findCampaignBrief('campaign-1');

    expect(result).toEqual(brief);
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
    const sql = mockedQueryOne.mock.calls[0][0] as string;
    const params = mockedQueryOne.mock.calls[0][1] as unknown[];
    expect(sql).toContain("status = 'approved'");
    expect(sql).toContain('ORDER BY approved_at DESC');
    expect(params).toEqual(['campaign-1']);
  });

  it('returns null when no approved brief exists', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await findCampaignBrief('campaign-1');

    expect(result).toBeNull();
  });
});

describe('approveBrief', () => {
  it('updates brief status to approved with approved_by', async () => {
    mockedPoolQuery.mockResolvedValueOnce(undefined);

    await approveBrief('campaign-1', 'user-42');

    expect(mockedPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedPoolQuery.mock.calls[0];
    expect(sql).toContain("SET status = 'approved'");
    expect(sql).toContain('approved_by = $2');
    expect(sql).toContain('approved_at = NOW()');
    expect(params).toEqual(['campaign-1', 'user-42']);
  });
});

describe('rejectBrief', () => {
  it('updates brief status to rejected', async () => {
    mockedPoolQuery.mockResolvedValueOnce(undefined);

    await rejectBrief('campaign-1');

    expect(mockedPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedPoolQuery.mock.calls[0];
    expect(sql).toContain("SET status = 'rejected'");
    expect(params).toEqual(['campaign-1']);
  });
});

describe('getCampaignLeadStats', () => {
  it('returns null when campaign is not found', async () => {
    mockedQueryOne.mockResolvedValueOnce(null);

    const result = await getCampaignLeadStats('missing');

    expect(result).toBeNull();
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
  });

  it('returns campaign stats and top pain points', async () => {
    const campaign = {
      id: 'campaign-1',
      name: 'Summer SaaS Push',
      target_industries: ['SaaS'],
      tone: 'friendly',
    };
    mockedQueryOne
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce({ total_leads: '10', eligible_leads: '8', high_fit_leads: '3' });
    mockedPoolQuery.mockResolvedValueOnce({
      rows: [
        { pain_points: ['price', 'support'] },
        { pain_points: ['price', 'timing'] },
        { pain_points: ['support'] },
        { pain_points: [] },
      ],
    });

    const result = await getCampaignLeadStats('campaign-1');

    expect(result).toEqual({
      campaign,
      totalLeads: 10,
      eligibleLeads: 8,
      highFitLeads: 3,
      topPainPoints: ['price', 'support', 'timing'],
    });
    expect(mockedQueryOne).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM campaigns WHERE id = $1 AND deleted_at IS NULL'),
      ['campaign-1'],
    );
    expect(mockedQueryOne).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM campaign_leads cl'),
      ['campaign-1'],
    );
    expect(mockedPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM lead_ai_profiles p'),
      ['campaign-1'],
    );
  });

  it('returns empty top pain points when no profiles have pain points', async () => {
    const campaign = {
      id: 'campaign-1',
      name: 'Empty Push',
      target_industries: ['Retail'],
      tone: 'formal',
    };
    mockedQueryOne
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce({ total_leads: '5', eligible_leads: '5', high_fit_leads: '0' });
    mockedPoolQuery.mockResolvedValueOnce({ rows: [{ pain_points: null }, { pain_points: [] }] });

    const result = await getCampaignLeadStats('campaign-1');

    expect(result).toEqual({
      campaign,
      totalLeads: 5,
      eligibleLeads: 5,
      highFitLeads: 0,
      topPainPoints: [],
    });
  });

  it('limits top pain points to five and sorts by frequency', async () => {
    const campaign = {
      id: 'campaign-1',
      name: 'Big Push',
      target_industries: ['SaaS'],
      tone: 'friendly',
    };
    mockedQueryOne
      .mockResolvedValueOnce(campaign)
      .mockResolvedValueOnce({ total_leads: '20', eligible_leads: '18', high_fit_leads: '10' });
    mockedPoolQuery.mockResolvedValueOnce({
      rows: [
        { pain_points: ['a', 'b', 'c', 'd', 'e', 'f'] },
        { pain_points: ['a', 'b', 'c', 'd', 'e'] },
        { pain_points: ['a', 'b', 'c', 'd'] },
        { pain_points: ['a', 'b', 'c'] },
        { pain_points: ['a', 'b'] },
        { pain_points: ['a'] },
      ],
    });

    const result = await getCampaignLeadStats('campaign-1');

    expect(result?.topPainPoints).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
