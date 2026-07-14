import { logger } from '../../shared/utils/logger';
import { executeAgentAction, rejectAgentAction } from '../agent/agent.service';
import { continuePlanIfReady } from '../agent-planner/runner.service';
import * as planRepository from '../agent-planner/plan.repository';
import { incAiInboxItem } from '../../shared/utils/metrics';
import {
  createItem,
  listItems,
  actionItem,
  runExpirySweep,
  findPendingItemForAgentAction,
} from './ai-inbox.service';
import * as repository from './ai-inbox.repository';
import type { AiInboxItem } from './ai-inbox.types';

jest.mock('./ai-inbox.repository');
jest.mock('../agent/agent.service');
jest.mock('../agent-planner/runner.service');
jest.mock('../agent-planner/plan.repository');
jest.mock('../../shared/utils/metrics');
jest.mock('../../shared/utils/logger');

const mockedRepo = repository as jest.Mocked<typeof repository>;
const mockedExecuteAgentAction = executeAgentAction as jest.MockedFunction<
  typeof executeAgentAction
>;
const mockedRejectAgentAction = rejectAgentAction as jest.MockedFunction<typeof rejectAgentAction>;
const mockedContinuePlan = continuePlanIfReady as jest.MockedFunction<typeof continuePlanIfReady>;
const mockedPlanRepo = planRepository as jest.Mocked<typeof planRepository>;

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
  agent_action_id: null,
  agent_plan_id: null,
  agent_plan_step_id: null,
  action_result: null,
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

    await expect(
      actionItem('missing-id', { id: 'user-1', role: 'admin' }, 'approve'),
    ).rejects.toThrow('Inbox item not found: missing-id');
    expect(mockedRepo.actionInboxItem).not.toHaveBeenCalled();
  });

  it('approves a pending item by setting status=actioned', async () => {
    const approvedItem = { ...baseItem, status: 'actioned' as const, actioned_by: 'user-1' };
    mockedRepo.actionInboxItem.mockResolvedValue(approvedItem);

    const result = await actionItem('inbox-1', { id: 'user-1', role: 'admin' }, 'approve');

    expect(mockedRepo.actionInboxItem).toHaveBeenCalledWith('inbox-1', {
      status: 'actioned',
      actioned_by: 'user-1',
      snoozed_until: undefined,
    });
    expect(result.status).toBe('actioned');
    expect(incAiInboxItem).toHaveBeenCalledWith('approve_response', 'approve');
  });

  it('executes linked agent action on approval with approver actor', async () => {
    const linkedItem = { ...baseItem, agent_action_id: 'agent-1' };
    const approvedItem = { ...linkedItem, status: 'actioned' as const, actioned_by: 'user-1' };
    mockedRepo.findInboxItemById.mockResolvedValue(linkedItem);
    mockedRepo.actionInboxItem.mockResolvedValue(approvedItem);
    mockedExecuteAgentAction.mockResolvedValue({
      id: 'agent-1',
      source: 'chat',
      action_name: 'lead.pause',
      action_args: {},
      risk_tier: 'sensitive_write',
      status: 'succeeded',
      requested_by: 'requester-1',
      requester_role: 'sales',
      requester_email: null,
      requester_name: null,
      approved_by: 'user-1',
      lead_id: 'lead-1',
      campaign_id: null,
      confidence: null,
      autonomy_level: null,
      idempotency_key: 'agent:key',
      result: { ok: true },
      error_message: null,
      source_message: null,
      expires_at: null,
      executed_at: '2026-06-29T00:00:00.000Z',
      created_at: baseItem.created_at,
      updated_at: baseItem.updated_at,
    });
    mockedRepo.setInboxActionResult.mockResolvedValue({
      ...approvedItem,
      action_result: { agentActionId: 'agent-1', status: 'succeeded', result: { ok: true } },
    });

    await actionItem('inbox-1', { id: 'user-1', role: 'admin' }, 'approve');

    expect(mockedExecuteAgentAction).toHaveBeenCalledWith('agent-1', {
      approvedBy: 'user-1',
      actor: { id: 'user-1', role: 'admin' },
    });
    expect(mockedRepo.setInboxActionResult).toHaveBeenCalled();
  });

  it('rejects a pending item by setting status=actioned', async () => {
    const rejectedItem = { ...baseItem, status: 'actioned' as const };
    mockedRepo.actionInboxItem.mockResolvedValue(rejectedItem);

    await actionItem('inbox-1', { id: 'user-1', role: 'admin' }, 'reject');

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

    await actionItem(
      'inbox-1',
      { id: 'user-1', role: 'admin' },
      'snooze',
      '2026-06-28T00:00:00.000Z',
    );

    expect(mockedRepo.actionInboxItem).toHaveBeenCalledWith('inbox-1', {
      status: 'snoozed',
      actioned_by: 'user-1',
      snoozed_until: '2026-06-28T00:00:00.000Z',
    });
    expect(incAiInboxItem).toHaveBeenCalledWith('approve_response', 'snooze');
  });

  it('throws when repository update returns null', async () => {
    mockedRepo.actionInboxItem.mockResolvedValue(null);

    await expect(actionItem('inbox-1', { id: 'user-1', role: 'admin' }, 'approve')).rejects.toThrow(
      'Failed to action inbox item: inbox-1',
    );
  });

  it('resumes the runner when approving an inbox item linked to a plan', async () => {
    const linkedItem: AiInboxItem = {
      ...baseItem,
      agent_action_id: 'action-1',
      agent_plan_id: 'plan-1',
      agent_plan_step_id: 'step-1',
    };
    const approvedItem = { ...linkedItem, status: 'actioned' as const, actioned_by: 'user-1' };
    mockedRepo.findInboxItemById.mockResolvedValue(linkedItem);
    mockedRepo.actionInboxItem.mockResolvedValue(approvedItem);
    mockedExecuteAgentAction.mockResolvedValue({
      id: 'action-1',
      source: 'chat',
      action_name: 'lead.pause',
      action_args: {},
      risk_tier: 'sensitive_write',
      status: 'succeeded',
      requested_by: 'requester-1',
      requester_role: 'sales',
      requester_email: null,
      requester_name: null,
      approved_by: 'user-1',
      lead_id: 'lead-1',
      campaign_id: null,
      confidence: null,
      autonomy_level: null,
      idempotency_key: 'agent:key',
      result: { ok: true },
      error_message: null,
      source_message: null,
      expires_at: null,
      executed_at: '2026-06-29T00:00:00.000Z',
      created_at: baseItem.created_at,
      updated_at: baseItem.updated_at,
    });
    mockedPlanRepo.findPlanStepById.mockResolvedValue({ id: 'step-1' } as any);
    mockedPlanRepo.updatePlanStepStatus.mockResolvedValue({ id: 'step-1' } as any);
    mockedContinuePlan.mockResolvedValue({
      planId: 'plan-1',
      status: 'succeeded',
      errorMessage: null,
    });

    await actionItem('inbox-1', { id: 'user-1', role: 'admin' }, 'approve');

    expect(mockedPlanRepo.findPlanStepById).toHaveBeenCalledWith('step-1');
    expect(mockedPlanRepo.updatePlanStepStatus).toHaveBeenCalledWith(
      'step-1',
      'succeeded',
      expect.objectContaining({ agentActionId: 'action-1' }),
    );
    expect(mockedContinuePlan).toHaveBeenCalledWith('plan-1');
  });
});

describe('runExpirySweep', () => {
  it('returns the number of expired items', async () => {
    mockedRepo.expireGuardedItems.mockResolvedValue([
      { id: 'inbox-1', lead_id: 'lead-1', ai_draft_response: 'Reply 1', agent_action_id: null },
      { id: 'inbox-2', lead_id: 'lead-2', ai_draft_response: 'Reply 2', agent_action_id: null },
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

  it('does not record an action result when linked expiry execution fails', async () => {
    mockedRepo.expireGuardedItems.mockResolvedValue([
      {
        id: 'inbox-1',
        lead_id: 'lead-1',
        ai_draft_response: 'Reply 1',
        agent_action_id: 'agent-1',
      },
    ]);
    mockedExecuteAgentAction.mockRejectedValue(new Error('Agent action is expired'));

    const result = await runExpirySweep();

    expect(result).toBe(1);
    expect(mockedExecuteAgentAction).toHaveBeenCalledWith('agent-1', { source: 'expiry' });
    expect(mockedRepo.setInboxActionResult).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'ai inbox: guarded item expiry execution failed',
      expect.objectContaining({ id: 'inbox-1', agentActionId: 'agent-1' }),
    );
  });
});

describe('findPendingItemForAgentAction', () => {
  it('delegates to the repository lookup', async () => {
    mockedRepo.findPendingInboxItemByAgentActionId.mockResolvedValue(baseItem);

    const result = await findPendingItemForAgentAction('agent-1');

    expect(result).toEqual(baseItem);
    expect(mockedRepo.findPendingInboxItemByAgentActionId).toHaveBeenCalledWith('agent-1');
  });

  it('returns null when nothing is pending', async () => {
    mockedRepo.findPendingInboxItemByAgentActionId.mockResolvedValue(null);

    const result = await findPendingItemForAgentAction('agent-missing');

    expect(result).toBeNull();
  });
});
