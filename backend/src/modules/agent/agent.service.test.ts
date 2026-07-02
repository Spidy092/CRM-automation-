import { executeAgentAction, proposeAgentAction } from './agent.service';
import * as repository from './agent.repository';
import * as actions from './agent.actions';
import { createItem } from '../ai-inbox/ai-inbox.service';

jest.mock('./agent.repository');
jest.mock('../ai-inbox/ai-inbox.service');
jest.mock('../ai-intelligence/ai-intelligence.repository', () => ({ insertDecisionLog: jest.fn().mockResolvedValue({ id: 'decision-1' }) }));
jest.mock('../../shared/utils/audit');
jest.mock('../../shared/utils/logger', () => ({ logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() } }));
jest.mock('../../shared/utils/metrics', () => ({
  incAgentAction: jest.fn(),
  observeAgentActionDuration: jest.fn(),
}));

const mockedRepo = repository as jest.Mocked<typeof repository>;
const mockedCreateItem = createItem as jest.MockedFunction<typeof createItem>;

const actionRow = {
  id: 'action-1',
  source: 'chat' as const,
  action_name: 'lead.pause' as const,
  action_args: { id: '11111111-1111-4111-8111-111111111111', paused: true },
  risk_tier: 'sensitive_write' as const,
  status: 'pending_approval' as const,
  requested_by: 'user-1',
  approved_by: null,
  requester_role: 'admin' as const,
  requester_email: 'admin@example.com',
  requester_name: 'Admin User',
  lead_id: '11111111-1111-4111-8111-111111111111',
  campaign_id: null,
  confidence: null,
  autonomy_level: null,
  idempotency_key: 'agent:key',
  result: null,
  error_message: null,
  source_message: 'pause lead',
  expires_at: null,
  executed_at: null,
  created_at: '2026-06-29T00:00:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z',
};

describe('proposeAgentAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRepo.createAgentAction.mockResolvedValue(actionRow);
    mockedCreateItem.mockResolvedValue({
      id: 'inbox-1',
      assigned_to: 'user-1',
      lead_id: actionRow.lead_id,
      campaign_id: null,
      item_type: 'approve_response',
      title: 'Approve agent action: lead.pause',
      summary: 'Chat write actions require explicit approval',
      urgency_score: 70,
      ai_draft_response: null,
      ai_draft_confidence: null,
      expires_at: null,
      status: 'pending',
      snoozed_until: null,
      actioned_by: null,
      actioned_at: null,
      created_at: actionRow.created_at,
      updated_at: actionRow.updated_at,
      agent_action_id: actionRow.id,
      agent_plan_id: null,
      agent_plan_step_id: null,
      action_result: null,
    });
  });

  it('creates pending approval and inbox item for chat writes', async () => {
    const result = await proposeAgentAction({
      source: 'chat',
      actionName: 'lead.pause',
      args: { id: '11111111-1111-4111-8111-111111111111', paused: true },
      actor: { id: 'user-1', role: 'admin' },
      sourceMessage: 'pause lead',
      forceApproval: true,
    });

    expect(result.policy.outcome).toBe('require_approval');
    expect(mockedRepo.createAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_approval', actionName: 'lead.pause' }),
    );
    expect(mockedCreateItem).toHaveBeenCalledWith(
      expect.objectContaining({ agent_action_id: 'action-1', assigned_to: 'user-1' }),
    );
  });

  it('rejects policy-denied viewer writes without creating action', async () => {
    const result = await proposeAgentAction({
      source: 'chat',
      actionName: 'lead.pause',
      args: { id: '11111111-1111-4111-8111-111111111111', paused: true },
      actor: { id: 'viewer-1', role: 'viewer' },
    });

    expect(result.policy.outcome).toBe('reject');
    expect(mockedRepo.createAgentAction).not.toHaveBeenCalled();
  });
});


describe('executeAgentAction', () => {
  it('executes with original requester role and rejects unauthorized approver', async () => {
    mockedRepo.findAgentActionById.mockResolvedValue({ ...actionRow, status: 'pending_approval' });
    mockedRepo.claimAgentActionForExecution.mockResolvedValue({ ...actionRow, status: 'pending_approval' });

    await expect(
      executeAgentAction('action-1', { actor: { id: 'viewer-1', role: 'viewer' }, approvedBy: 'viewer-1' }),
    ).rejects.toThrow('Approver role is not allowed to approve this action');
  });


  it('marks stale pending actions expired before execution', async () => {
    mockedRepo.findAgentActionById.mockResolvedValue({
      ...actionRow,
      status: 'pending_approval',
      expires_at: '2026-01-01T00:00:00.000Z',
    });

    await expect(
      executeAgentAction('action-1', { actor: { id: 'user-1', role: 'admin' }, approvedBy: 'user-1' }),
    ).rejects.toThrow('Agent action has expired');

    expect(mockedRepo.updateAgentActionStatus).toHaveBeenCalledWith('action-1', 'expired', {
      errorMessage: 'Agent action has expired',
    });
    expect(mockedRepo.claimAgentActionForExecution).not.toHaveBeenCalled();
  });
});
