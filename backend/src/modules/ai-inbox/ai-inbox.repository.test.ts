import { pool, queryOne } from '../../shared/utils/db';
import {
  createInboxItem,
  findInboxItems,
  countInboxItems,
  findInboxItemById,
  findPendingInboxItemByAgentActionId,
  actionInboxItem,
  autoResolveItemsForLead,
  expireGuardedItems,
} from './ai-inbox.repository';
import type { AiInboxItem } from './ai-inbox.types';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));

const mockedQueryOne = queryOne as jest.MockedFunction<typeof queryOne>;
const mockedPoolQuery = pool.query as jest.Mock;

const makeItem = (overrides: Partial<AiInboxItem> = {}): AiInboxItem => ({
  id: 'item-1',
  assigned_to: 'user-1',
  lead_id: 'lead-1',
  campaign_id: null,
  item_type: 'urgent_reply',
  title: 'New urgent reply',
  summary: 'Customer asks about pricing',
  urgency_score: 85,
  ai_draft_response: 'Hi, here is our pricing...',
  ai_draft_confidence: 0.92,
  expires_at: null,
  status: 'pending',
  snoozed_until: null,
  actioned_by: null,
  actioned_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
  agent_action_id: null,
  agent_plan_id: null,
  agent_plan_step_id: null,
  action_result: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createInboxItem', () => {
  it('returns created item on success', async () => {
    const item = makeItem();
    mockedQueryOne.mockResolvedValue(item);

    const result = await createInboxItem({
      assigned_to: 'user-1',
      lead_id: 'lead-1',
      item_type: 'urgent_reply',
      title: 'New urgent reply',
      summary: 'Customer asks about pricing',
      urgency_score: 85,
      ai_draft_response: 'Hi, here is our pricing...',
      ai_draft_confidence: 0.92,
    });

    expect(result).toEqual(item);
    expect(mockedQueryOne).toHaveBeenCalledTimes(1);
  });

  it('throws when insert returns null', async () => {
    mockedQueryOne.mockResolvedValue(null);

    await expect(
      createInboxItem({
        assigned_to: 'user-1',
        item_type: 'pricing_inquiry',
        title: 'Pricing question',
        urgency_score: 70,
      }),
    ).rejects.toThrow('Failed to create inbox item');
  });

  it('passes null for omitted optional fields', async () => {
    mockedQueryOne.mockResolvedValue(makeItem());

    await createInboxItem({
      assigned_to: 'user-1',
      item_type: 'pricing_inquiry',
      title: 'Pricing question',
      urgency_score: 70,
    });

    const params = mockedQueryOne.mock.calls[0][1] as unknown[];
    expect(params[1]).toBeNull(); // lead_id
    expect(params[2]).toBeNull(); // campaign_id
    expect(params[5]).toBeNull(); // summary
    expect(params[7]).toBeNull(); // ai_draft_response
    expect(params[9]).toBeNull(); // expires_at
  });
});

describe('findInboxItems', () => {
  it('returns items for assigned user', async () => {
    const items = [makeItem(), makeItem({ id: 'item-2', title: 'Second item' })];
    mockedPoolQuery.mockResolvedValue({ rows: items });

    const result = await findInboxItems({ assigned_to: 'user-1' });

    expect(result).toEqual(items);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no rows', async () => {
    mockedPoolQuery.mockResolvedValue({ rows: [] });

    const result = await findInboxItems({ assigned_to: 'user-1' });

    expect(result).toEqual([]);
  });

  it('excludes auto_resolved by default', async () => {
    mockedPoolQuery.mockResolvedValue({ rows: [] });

    await findInboxItems({ assigned_to: 'user-1' });

    const sql = mockedPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status != 'auto_resolved'");
  });

  it('filters by explicit status', async () => {
    mockedPoolQuery.mockResolvedValue({ rows: [] });

    await findInboxItems({ assigned_to: 'user-1', status: 'actioned' });

    const sql = mockedPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('status = $2');
    expect(sql).not.toContain("status != 'auto_resolved'");
  });

  it('clamps limit to 100', async () => {
    mockedPoolQuery.mockResolvedValue({ rows: [] });

    await findInboxItems({ assigned_to: 'user-1', limit: 500 });

    const params = mockedPoolQuery.mock.calls[0][1] as unknown[];
    expect(params[params.length - 2]).toBe(100);
  });
});

describe('countInboxItems', () => {
  it('returns parsed count', async () => {
    mockedQueryOne.mockResolvedValue({ count: '5' });

    const result = await countInboxItems('user-1');

    expect(result).toBe(5);
  });

  it('returns 0 when count is null', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await countInboxItems('user-1');

    expect(result).toBe(0);
  });
});

describe('findInboxItemById', () => {
  it('returns item when found', async () => {
    const item = makeItem();
    mockedQueryOne.mockResolvedValue(item);

    const result = await findInboxItemById('item-1');

    expect(result).toEqual(item);
  });

  it('returns null when not found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await findInboxItemById('missing');

    expect(result).toBeNull();
  });
});

describe('findPendingInboxItemByAgentActionId', () => {
  it('returns the pending item when found', async () => {
    const item = makeItem({ agent_action_id: 'action-1' });
    mockedQueryOne.mockResolvedValue(item);

    const result = await findPendingInboxItemByAgentActionId('action-1');

    expect(result).toEqual(item);
    expect(mockedQueryOne).toHaveBeenCalledWith(expect.stringContaining("status = 'pending'"), [
      'action-1',
    ]);
  });

  it('returns null when no pending item is linked', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await findPendingInboxItemByAgentActionId('action-missing');

    expect(result).toBeNull();
  });
});

describe('actionInboxItem', () => {
  it('returns updated item', async () => {
    const item = makeItem({ status: 'actioned', actioned_by: 'user-1' });
    mockedQueryOne.mockResolvedValue(item);

    const result = await actionInboxItem('item-1', { status: 'actioned', actioned_by: 'user-1' });

    expect(result).toEqual(item);
  });

  it('returns null when not found', async () => {
    mockedQueryOne.mockResolvedValue(null);

    const result = await actionInboxItem('missing', { status: 'snoozed' });

    expect(result).toBeNull();
  });
});

describe('autoResolveItemsForLead', () => {
  it('updates pending items for lead', async () => {
    mockedPoolQuery.mockResolvedValue({ rowCount: 2 });

    await autoResolveItemsForLead('lead-1');

    const sql = mockedPoolQuery.mock.calls[0][0] as string;
    const params = mockedPoolQuery.mock.calls[0][1] as unknown[];
    expect(sql).toContain("status = 'auto_resolved'");
    expect(sql).toContain('lead_id = $1');
    expect(params).toEqual(['lead-1']);
  });
});

describe('expireGuardedItems', () => {
  it('returns expired rows', async () => {
    const rows = [
      { id: 'item-1', lead_id: 'lead-1', ai_draft_response: 'Draft 1' },
      { id: 'item-2', lead_id: null, ai_draft_response: null },
    ];
    mockedPoolQuery.mockResolvedValue({ rows });

    const result = await expireGuardedItems();

    expect(result).toEqual(rows);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when none expired', async () => {
    mockedPoolQuery.mockResolvedValue({ rows: [] });

    const result = await expireGuardedItems();

    expect(result).toEqual([]);
  });
});
