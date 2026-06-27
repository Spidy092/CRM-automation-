import { logger } from '../../shared/utils/logger';
import { incAiInboxItem } from '../../shared/utils/metrics';
import {
  createItem,
  listItems,
  actionItem,
  runExpirySweep,
} from './ai-inbox.service';
import * as repository from './ai-inbox.repository';
import type { AiInboxItem } from './ai-inbox.types';

jest.mock('./ai-inbox.repository');
jest.mock('../../shared/utils/metrics');
jest.mock('../../shared/utils/logger');

const mockedRepo = repository as jest.Mocked<typeof repository>;

const baseItem: AiInboxItem = {
  id: 'inbox-1',
  assigned_to: 'user-1',
  lead_id: 'lead-1',
  campaign_id: null,
  item_type: 'approve_response',
  title: 'Test inbox item',
  summary: 'A draft reply',
  urgency_score: 80,
  ai_draft_response: 'Hello, thanks for reaching out...',
  ai_draft_confidence: 0.92,
  expires_at: '2026-06-27T00:00:00.000Z',
  status: 'pending',
  snoozed_until: null,
  actioned_by: null,
  actioned_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
  updated_at: '2026-06-26T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createItem', () => {
  it('creates item via repository and increments created metric', async () => {
    mockedRepo.createInboxItem.mockResolvedValue(baseItem);

    const result = await createItem({
      assigned_to: 'user-1',
      lead_id: 'lead-1',
      item_type: 'approve_response',
      title: 'Test inbox item',
      summary: 'A draft reply',
      urgency_score: 80,
    });

    expect(mockedRepo.createInboxItem).toHaveBeenCalledTimes(1);
    expect(result).toEqual(baseItem);
    expect(incAiInboxItem).toHaveBeenCalledWith('approve_response', 'created');
    expect(logger.info).toHaveBeenCalledWith(
      'ai inbox: item created',
      expect.objectContaining({ id: 'inbox-1' }),
    );
  });
});

describe('listItems', () => {
  it('returns items and total from parallel repository calls', async () => {
    mockedRepo.findInboxItems.mockResolvedValue([baseItem]);
    mockedRepo.countInboxItems.mockResolvedValue(42);

    const result = await listItems({ assigned_to: 'user-1' });

    expect(result).toEqual({ items: [baseItem], total: 42 });
    expect(mockedRepo.findInboxItems).toHaveBeenCalledWith({ assigned_to: 'user-1' });
    expect(mockedRepo.countInboxItems).toHaveBeenCalledWith('user-1');
  });

  it('returns empty list when repository returns no items', async () => {
    mockedRepo.findInboxItems.mockResolvedValue([]);
    mockedRepo.countInboxItems.mockResolvedValue(0);

    const result = await listItems({ assigned_to: 'user-2' });

    expect(result).toEqual({ items: [], total: 0 });
  });

  it('forwards status and item_type filters to findInboxItems', async () => {
    mockedRepo.findInboxItems.mockResolvedValue([baseItem]);
    mockedRepo.countInboxItems.mockResolvedValue(1);

    await listItems({
      assigned_to: 'user-1',
      status: 'pending',
      item_type: 'urgent_reply',
    });

    expect(mockedRepo.findInboxItems).toHaveBeenCalledWith({
      assigned_to: 'user-1',
      status: 'pending',
      item_type: 'urgent_reply',
    });
  });
});

describe('actionItem', () => {
  beforeEach(() => {
    mockedRepo.findInboxItemById.mockResolvedValue(baseItem);
  });

  it('throws when item does not exist (404 path)', async () => {
    mockedRepo.findInboxItemById.mockResolvedValue(null);

    await expect(actionItem('missing-id', 'user-1', 'approve')).rejects.toThrow(
      'Inbox item not found: missing-id',
    );
    expect(mockedRepo.actionInboxItem).not.toHaveBeenCalled();
  });

  it('approves a pending item by setting status=actioned', async () => {
    const approvedItem = { ...baseItem, status: 'actioned' as const, actioned_by: 'user-1' };
    mockedRepo.actionInboxItem.mockResolvedValue(approvedItem);

    const result = await actionItem('inbox-1', 'user-1', 'approve');

    expect(mockedRepo.actionInboxItem).toHaveBeenCalledWith('inbox-1', {
      status: 'actioned',
      actioned_by: 'user-1',
      snoozed_until: undefined,
    });
    expect(result.status).toBe('actioned');
    expect(incAiInboxItem).toHaveBeenCalledWith('approve_response', 'approve');
  });

  it('rejects a pending item by setting status=actioned', async () => {
    const rejectedItem = { ...baseItem, status: 'actioned' as const };
    mockedRepo.actionInboxItem.mockResolvedValue(rejectedItem);

    await actionItem('inbox-1', 'user-1', 'reject');

    expect(mockedRepo.actionInboxItem).toHaveBeenCalledWith('inbox-1', {
      status: 'actioned',
      actioned_by: 'user-1',
      snoozed_until: undefined,
    });
    expect(incAiInboxItem).toHaveBeenCalledWith('approve_response', 'reject');
  });

  it('snoozes a pending item with snoozed_until timestamp', async () => {
    const snoozedItem = {
      ...baseItem,
      status: 'snoozed' as const,
      snoozed_until: '2026-06-28T00:00:00.000Z',
    };
    mockedRepo.actionInboxItem.mockResolvedValue(snoozedItem);

    await actionItem('inbox-1', 'user-1', 'snooze', '2026-06-28T00:00:00.000Z');

    expect(mockedRepo.actionInboxItem).toHaveBeenCalledWith('inbox-1', {
      status: 'snoozed',
      actioned_by: 'user-1',
      snoozed_until: '2026-06-28T00:00:00.000Z',
    });
    expect(incAiInboxItem).toHaveBeenCalledWith('approve_response', 'snooze');
  });

  it('throws when repository update returns null', async () => {
    mockedRepo.actionInboxItem.mockResolvedValue(null);

    await expect(actionItem('inbox-1', 'user-1', 'approve')).rejects.toThrow(
      'Failed to action inbox item: inbox-1',
    );
  });
});

describe('runExpirySweep', () => {
  it('returns the number of expired items', async () => {
    mockedRepo.expireGuardedItems.mockResolvedValue([
      { id: 'inbox-1', lead_id: 'lead-1', ai_draft_response: 'Reply 1' },
      { id: 'inbox-2', lead_id: 'lead-2', ai_draft_response: 'Reply 2' },
    ]);

    const result = await runExpirySweep();

    expect(result).toBe(2);
    expect(incAiInboxItem).toHaveBeenCalledTimes(2);
    expect(incAiInboxItem).toHaveBeenCalledWith('approve_response', 'auto_resolved');
  });

  it('returns 0 when no items expired', async () => {
    mockedRepo.expireGuardedItems.mockResolvedValue([]);

    const result = await runExpirySweep();

    expect(result).toBe(0);
    expect(incAiInboxItem).not.toHaveBeenCalled();
  });
});
