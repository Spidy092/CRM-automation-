/**
 * Events worker tests.
 *
 * Tests handleStageMoved routing based on lead AI next-best-action.
 */

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}));

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
  enqueueOutreachDispatch: jest.fn(),
  enqueueOutreachFollowUp: jest.fn(),
  enqueueOutreachStopCheck: jest.fn(),
  enqueueAiResearch: jest.fn(),
  enqueueAiDecision: jest.fn(),
  enqueueAiCreateInboxItem: jest.fn(),
  cancelPendingOutreachJobs: jest.fn(),
  scoringQueue: { add: jest.fn() },
  SCORING_CALCULATE_LEAD: 'scoring:calculate-lead',
  LEAD_EVENTS_QUEUE: 'lead-events',
  LEAD_EVENT: 'lead:event',
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

jest.mock('../shared/utils/sentry', () => ({
  Sentry: { captureException: jest.fn() },
}));

jest.mock('../lib/dlq', () => ({
  moveToDLQ: jest.fn(),
}));

jest.mock('../modules/campaigns/campaigns.repository', () => ({
  findActiveCampaignsByPipeline: jest.fn(),
  addLeadsToCampaign: jest.fn(),
}));

jest.mock('../modules/outreach/outreach.repository', () => ({
  findSequenceById: jest.fn(),
  findNextBestActionByLeadId: jest.fn(),
}));

jest.mock('../modules/leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));

jest.mock('../modules/users/users.repository', () => ({
  findUserById: jest.fn(),
}));

jest.mock('../modules/agent/agent.service', () => ({
  proposeAgentAction: jest.fn(),
}));

jest.mock('../modules/notifications/notifications.emitter', () => ({
  pushToUser: jest.fn(),
}));

jest.mock('../shared/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { handleStageMoved, handleLeadEvent, startEventsWorker } from './events.worker';
import { findActiveCampaignsByPipeline, addLeadsToCampaign } from '../modules/campaigns/campaigns.repository';
import { findSequenceById, findNextBestActionByLeadId } from '../modules/outreach/outreach.repository';
import { findLeadById } from '../modules/leads/leads.repository';
import { findUserById } from '../modules/users/users.repository';
import { proposeAgentAction } from '../modules/agent/agent.service';
import { pushToUser } from '../modules/notifications/notifications.emitter';
import {
  enqueueOutreachDispatch,
  enqueueAiResearch,
  enqueueAiDecision,
  enqueueAiCreateInboxItem,
  scoringQueue,
  cancelPendingOutreachJobs,
} from './queue';
import { logger } from '../shared/utils/logger';

const mockFindActiveCampaignsByPipeline = findActiveCampaignsByPipeline as jest.Mock;
const mockAddLeadsToCampaign = addLeadsToCampaign as jest.Mock;
const mockFindSequenceById = findSequenceById as jest.Mock;
const mockFindNextBestActionByLeadId = findNextBestActionByLeadId as jest.Mock;
const mockFindLeadById = findLeadById as jest.Mock;
const mockFindUserById = findUserById as jest.Mock;
const mockProposeAgentAction = proposeAgentAction as jest.Mock;
const mockPushToUser = pushToUser as jest.Mock;
const mockEnqueueOutreachDispatch = enqueueOutreachDispatch as jest.Mock;
const mockEnqueueAiResearch = enqueueAiResearch as jest.Mock;
const mockEnqueueAiDecision = enqueueAiDecision as jest.Mock;
const mockEnqueueAiCreateInboxItem = enqueueAiCreateInboxItem as jest.Mock;
const mockScoringQueueAdd = scoringQueue.add as jest.Mock;
const mockCancelPendingOutreachJobs = cancelPendingOutreachJobs as jest.Mock;

const baseCampaign = {
  id: 'camp1',
  name: 'Campaign One',
  sequence_id: 'seq1',
  pipeline_id: 'pipe1',
  ai_personalization_enabled: false,
  status: 'active',
  tone: 'professional',
  target_industries: [],
  target_countries: [],
  autonomy_level: 'supervised',
  ai_min_confidence: 70,
  created_by: 'u1',
  launched_at: null,
  created_at: '2026-06-25T00:00:00Z',
  updated_at: '2026-06-25T00:00:00Z',
};

const baseSequence = {
  id: 'seq1',
  name: 'Sequence One',
  steps: [
    { stepNumber: 1, channel: 'phone_call', templateId: 't1', delayHours: 0 },
    { stepNumber: 2, channel: 'email', templateId: 't2', delayHours: 24 },
  ],
  created_by: 'u1',
  created_at: '2026-06-25T00:00:00Z',
  updated_at: '2026-06-25T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindActiveCampaignsByPipeline.mockResolvedValue([baseCampaign]);
  mockFindSequenceById.mockResolvedValue(baseSequence);
  mockFindNextBestActionByLeadId.mockResolvedValue(null);
  mockFindLeadById.mockResolvedValue(null);
  mockFindUserById.mockResolvedValue({
    id: 'rep1',
    name: 'Sales Rep',
    email: 'rep@example.com',
    role: 'sales',
    is_active: true,
    created_at: new Date('2026-06-25T00:00:00Z'),
  });
  mockProposeAgentAction.mockResolvedValue({
    policy: { outcome: 'require_approval', reason: 'Action requires human approval', assignTo: 'rep1' },
    action: { id: 'agent-action-1' },
  });
});

describe('startEventsWorker', () => {
  it('starts without error', () => {
    expect(() => startEventsWorker()).not.toThrow();
  });
});

describe('handleStageMoved', () => {
  it('returns early when pipelineId is missing', async () => {
    await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1' });
    expect(mockFindActiveCampaignsByPipeline).not.toHaveBeenCalled();
    expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'lead.stage_moved: pipelineId missing from payload, skipping auto-enrollment',
      { leadId: 'lead1', toStageId: 's1' },
    );
  });

  it('returns early when no active campaigns exist', async () => {
    mockFindActiveCampaignsByPipeline.mockResolvedValue([]);
    await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });
    expect(mockFindNextBestActionByLeadId).not.toHaveBeenCalled();
    expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'lead.stage_moved: no active campaigns for pipeline',
      { leadId: 'lead1', pipelineId: 'pipe1' },
    );
  });

  it('enqueues default outreach when no next_best_action exists', async () => {
    await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });
    expect(mockFindNextBestActionByLeadId).toHaveBeenCalledWith('lead1');
    expect(mockAddLeadsToCampaign).toHaveBeenCalledWith('camp1', ['lead1']);
    expect(mockEnqueueOutreachDispatch).toHaveBeenCalledWith({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      stepNumber: 1,
      channel: 'phone_call',
      templateId: 't1',
      mockMode: false,
      aiPersonalizationEnabled: false,
    });
  });

  it('pushes notification when lead has assigned rep and default outreach is dispatched', async () => {
    mockFindLeadById.mockResolvedValue({ id: 'lead1', assigned_to: 'rep1', business_name: 'Acme' });
    await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });
    expect(mockPushToUser).toHaveBeenCalledWith(
      'rep1',
      expect.objectContaining({
        type: 'campaign_enrolled',
        data: { leadId: 'lead1', campaignId: 'camp1' },
      }),
    );
  });

  describe('channel switch actions', () => {
    it.each([
      ['send_email', 'email'],
      ['send_sms', 'sms'],
      ['send_whatsapp', 'whatsapp'],
    ] as const)('routes %s through an agent action using %s', async (action, expectedChannel) => {
      mockFindLeadById.mockResolvedValue({ id: 'lead1', assigned_to: 'rep1', business_name: 'Acme' });
      mockFindNextBestActionByLeadId.mockResolvedValue({
        action,
        reason: 'preferred channel',
        confidence: 90,
      });

      await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });

      expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
      expect(mockProposeAgentAction).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'ai_decision',
          actionName: 'outreach.send_manual',
          actor: expect.objectContaining({ id: 'rep1', role: 'sales' }),
          assignTo: 'rep1',
          confidence: 90,
          autonomyLevel: 'supervised',
          aiMinConfidence: 70,
          args: expect.objectContaining({
            leadId: 'lead1',
            campaignId: 'camp1',
            sequenceId: 'seq1',
            stepNumber: 1,
            channel: expectedChannel,
            templateId: 't1',
            mockMode: false,
          }),
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'lead.stage_moved: outreach channel routed through agent action',
        expect.objectContaining({ leadId: 'lead1', action, channel: expectedChannel, agentActionId: 'agent-action-1' }),
      );
    });

    it('routes to review when no assigned actor can be resolved for AI outreach', async () => {
      mockFindLeadById.mockResolvedValue({ id: 'lead1', assigned_to: null, business_name: 'Acme' });
      mockFindNextBestActionByLeadId.mockResolvedValue({
        action: 'send_email',
        reason: 'preferred channel',
        confidence: 90,
      });

      await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });

      expect(mockProposeAgentAction).not.toHaveBeenCalled();
      expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'lead.stage_moved: no assigned actor for next_best_action outreach, routing to review',
        expect.objectContaining({ leadId: 'lead1', campaignId: 'camp1', action: 'send_email' }),
      );
    });
  });

  describe('skip outreach actions', () => {
    it.each(['disqualify', 'wait_and_followup', 'request_human_approval'])('skips outreach when action is %s', async (action) => {
      mockFindNextBestActionByLeadId.mockResolvedValue({
        action,
        reason: 'not ready',
        confidence: 80,
      });

      await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });

      expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
      expect(mockAddLeadsToCampaign).toHaveBeenCalledWith('camp1', ['lead1']);
      expect(logger.info).toHaveBeenCalledWith(
        'lead.stage_moved: skipping outreach per next_best_action',
        expect.objectContaining({ leadId: 'lead1', action }),
      );
    });
  });

  describe('other skip actions', () => {
    it.each(['call', 'escalate_to_rep', 'move_to_nurture', 'request_review'] as const)(
      'skips outreach and creates review item for action %s',
      async (action) => {
        mockFindLeadById.mockResolvedValue({ id: 'lead1', assigned_to: 'rep1', business_name: 'Acme' });
        mockFindNextBestActionByLeadId.mockResolvedValue({
          action,
          reason: 'needs human touch',
          confidence: 85,
        });

        await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });

        expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
          'lead.stage_moved: outreach skipped per next_best_action',
          expect.objectContaining({ leadId: 'lead1', action }),
        );
        expect(mockEnqueueAiCreateInboxItem).toHaveBeenCalledWith(
          expect.objectContaining({ assignedTo: 'rep1', leadId: 'lead1', campaignId: 'camp1' }),
        );
      },
    );
  });

  it('skips campaign when sequence_id is missing', async () => {
    mockFindActiveCampaignsByPipeline.mockResolvedValue([{ ...baseCampaign, sequence_id: null }]);
    await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });
    expect(mockFindSequenceById).not.toHaveBeenCalled();
    expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('skips campaign when sequence is not found', async () => {
    mockFindSequenceById.mockResolvedValue(null);
    await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });
    expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'campaign sequence not found, skipping enrollment',
      expect.any(Object),
    );
  });

  it('skips campaign when sequence has no steps', async () => {
    mockFindSequenceById.mockResolvedValue({ ...baseSequence, steps: [] });
    await handleStageMoved('lead1', { fromStageId: 's0', toStageId: 's1', pipelineId: 'pipe1' });
    expect(mockEnqueueOutreachDispatch).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'campaign sequence has no steps, skipping enrollment',
      expect.any(Object),
    );
  });
});

describe('handleLeadEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles lead.created by enqueueing scoring and AI research', async () => {
    await handleLeadEvent({ event: 'lead.created', leadId: 'lead1', payload: {} });
    expect(mockScoringQueueAdd).toHaveBeenCalledWith('scoring:calculate-lead', { leadId: 'lead1' });
    expect(mockEnqueueAiResearch).toHaveBeenCalledWith({ leadId: 'lead1' });
    expect(logger.info).toHaveBeenCalledWith(
      'lead.created → scoring + ai research enqueued',
      { leadId: 'lead1' },
    );
  });

  it('handles lead.status_changed by cancelling pending outreach for terminal statuses', async () => {
    mockCancelPendingOutreachJobs.mockResolvedValue(3);
    await handleLeadEvent({
      event: 'lead.status_changed',
      leadId: 'lead1',
      payload: { status: 'paused' },
    });
    expect(cancelPendingOutreachJobs).toHaveBeenCalledWith({ leadId: 'lead1' });
    expect(logger.info).toHaveBeenCalledWith(
      'lead.status_changed: cancelled pending outreach jobs',
      { leadId: 'lead1', status: 'paused', removed: 3 },
    );
  });

  it('handles lead.status_changed without cancelling for active status', async () => {
    await handleLeadEvent({
      event: 'lead.status_changed',
      leadId: 'lead1',
      payload: { status: 'active' },
    });
    expect(cancelPendingOutreachJobs).not.toHaveBeenCalled();
  });

  it('handles lead.assigned by logging', async () => {
    await handleLeadEvent({
      event: 'lead.assigned',
      leadId: 'lead1',
      payload: { assignedTo: 'rep1' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'lead.assigned',
      { leadId: 'lead1', assignedTo: 'rep1' },
    );
  });

  it('handles lead.scored by logging', async () => {
    await handleLeadEvent({
      event: 'lead.scored',
      leadId: 'lead1',
      payload: { score: 85, classification: 'hot' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      'lead.scored',
      { leadId: 'lead1', score: 85, classification: 'hot' },
    );
    expect(mockEnqueueAiDecision).toHaveBeenCalledWith({
      leadId: 'lead1',
      force: true,
      context: { score: 85, classification: 'hot' },
    });
  });

  it('logs warning for unknown events', async () => {
    await handleLeadEvent({
      event: 'lead.unknown' as any,
      leadId: 'lead1',
      payload: {},
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'unknown lead event',
      { event: 'lead.unknown', leadId: 'lead1' },
    );
  });
});
