/**
 * Outreach worker — durable execution path.
 *
 * Covers pause racing with dispatch claims, duplicate/stale execution
 * handling, atomic capacity deferral, failure recording without blind
 * retries, and worker-restart recovery semantics. The rollout flag is on;
 * the execution repository is mocked; provider outcomes use a recording
 * connector double (dispatchOutbound mock) — never a real send.
 */
import { handleDispatch, handleFollowUp } from './outreach.worker';

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
  enqueueOutreachDispatch: jest.fn(),
  enqueueOutreachFollowUp: jest.fn(),
  enqueueOutreachStopCheck: jest.fn(),
  buildTransportJobId: jest.requireActual('./queue').buildTransportJobId,
  OUTREACH_QUEUE: 'outreach',
}));
jest.mock('../shared/utils/db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));
jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));
jest.mock('../modules/outreach/outreach.repository', () => ({
  findSequenceByIdIncludingDeleted: jest.fn(),
  findSequenceById: jest.fn(),
  findLogsByLead: jest.fn(),
}));
jest.mock('../modules/outreach/outreach.service', () => ({
  createLog: jest.fn(),
  updateLogStatus: jest.fn(),
  createTask: jest.fn(),
}));
jest.mock('../modules/leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));
jest.mock('../modules/templates/templates.repository', () => ({
  findTemplateById: jest.fn(),
}));
jest.mock('../modules/campaigns/campaigns.repository', () => ({
  findCampaignById: jest.fn(),
  isCampaignLeadEnrolled: jest.fn(async () => []),
  countSentTodayForCampaign: jest.fn(),
}));
jest.mock('../modules/campaigns/campaigns.execution.repository', () => ({
  buildDedupeKey: jest.requireActual('../modules/campaigns/campaigns.execution.repository')
    .buildDedupeKey,
  claimDueStepExecutionTx: jest.fn(),
  enrollIntentTx: jest.fn(),
  findExecutionByDedupeKey: jest.fn(),
  findExpiredLeaseExecutions: jest.fn(),
  findLatestSnapshot: jest.fn(),
  findLatestStepExecution: jest.fn(),
  findSnapshotById: jest.fn(),
  findStaleScheduledExecutions: jest.fn(),
  findUnscheduledDueExecutions: jest.fn(),
  getEnrollmentState: jest.fn(),
  insertStepExecution: jest.fn(),
  markExecutionFailed: jest.fn(),
  markExecutionSent: jest.fn(),
  markExecutionSkipped: jest.fn(),
  markExecutionTransportScheduled: jest.fn(),
  markExecutionUncertain: jest.fn(),
  pauseCampaignTx: jest.fn(),
  recordAcceptanceTx: jest.fn(),
  releaseDailyCapacity: jest.fn(),
  releaseExecutionClaim: jest.fn(),
  reserveDailyCapacity: jest.fn(),
  restoreIntentTx: jest.fn(),
  resumeEnrollmentTx: jest.fn(),
  upsertEnrollmentState: jest.fn(),
}));
jest.mock('../modules/outreach/unsubscribe.service', () => ({
  createOutreachUnsubscribeUrl: jest.fn().mockResolvedValue('https://example.com/u?token=x'),
}));
jest.mock('../modules/integrations/dispatch', () => ({
  dispatchOutbound: jest.fn(),
}));
jest.mock('../modules/outreach/outreach.prompt', () => ({
  personalizeMessage: jest.fn(),
}));
jest.mock('../modules/campaigns/campaigns.service', () => ({
  getCampaignMessageSettings: jest.fn().mockResolvedValue(null),
}));

import {
  findSequenceByIdIncludingDeleted,
  findSequenceById,
  findLogsByLead,
} from '../modules/outreach/outreach.repository';
import { createLog, updateLogStatus } from '../modules/outreach/outreach.service';
import { findLeadById } from '../modules/leads/leads.repository';
import { findTemplateById } from '../modules/templates/templates.repository';
import {
  findCampaignById,
  isCampaignLeadEnrolled,
  countSentTodayForCampaign,
} from '../modules/campaigns/campaigns.repository';
import {
  claimDueStepExecutionTx,
  findExecutionByDedupeKey,
  findSnapshotById,
  getEnrollmentState,
  markExecutionFailed,
  markExecutionSkipped,
  recordAcceptanceTx,
  reserveDailyCapacity,
  releaseExecutionClaim,
} from '../modules/campaigns/campaigns.execution.repository';
import { dispatchOutbound } from '../modules/integrations/dispatch';
import { personalizeMessage } from '../modules/outreach/outreach.prompt';
import { enqueueOutreachDispatch, enqueueOutreachFollowUp } from './queue';

const originalFlag = process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;

const activeCampaign = {
  id: 'camp-1',
  status: 'active',
  ai_personalization_enabled: false,
  send_window_enabled: false,
  send_window_start_hour: 9,
  send_window_end_hour: 18,
  send_window_days: [1, 2, 3, 4, 5],
  send_window_timezone: 'UTC',
  daily_send_limit: null,
};

const snapshotSteps = [
  { stepNumber: 1, channel: 'email', delayHours: 0, templateId: 'tmpl-1' },
  { stepNumber: 2, channel: 'email', delayHours: 24, templateId: 'tmpl-2' },
];

const durableJob = {
  leadId: 'lead-1',
  campaignId: 'camp-1',
  sequenceId: 'seq-1',
  stepNumber: 1,
  channel: 'email' as const,
  templateId: 'tmpl-1',
  mockMode: true,
  executionId: 'cmp:camp-1:lead-1:snap-1:s1:g0:a0',
  generation: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
  (findCampaignById as jest.Mock).mockResolvedValue(activeCampaign);
  (isCampaignLeadEnrolled as jest.Mock).mockResolvedValue(true);
  (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1', status: 'active' });
  (findLogsByLead as jest.Mock).mockResolvedValue([]);
  (findTemplateById as jest.Mock).mockResolvedValue({
    id: 'tmpl-1',
    approval_status: 'approved',
    subject: 'Hi',
  });
  (countSentTodayForCampaign as jest.Mock).mockResolvedValue(0);
  (findExecutionByDedupeKey as jest.Mock).mockResolvedValue({
    dedupe_key: durableJob.executionId,
    snapshot_id: 'snap-1',
    step_number: 1,
    generation: 0,
    state: 'scheduled',
  });
  (findSnapshotById as jest.Mock).mockResolvedValue({
    id: 'snap-1',
    sequence_id: 'seq-1',
    steps: snapshotSteps,
  });
  (getEnrollmentState as jest.Mock).mockResolvedValue({
    enrollment_status: 'active',
    scheduling_generation: 0,
    completed_steps: 0,
    sequence_snapshot_id: 'snap-1',
    lead_id: 'lead-1',
  });
  (claimDueStepExecutionTx as jest.Mock).mockResolvedValue({
    dedupe_key: durableJob.executionId,
    step_number: 1,
    snapshot_id: 'snap-1',
    state: 'claimed',
  });
  (createLog as jest.Mock).mockResolvedValue({ id: 'log-1' });
  (updateLogStatus as jest.Mock).mockResolvedValue({ id: 'log-1', status: 'sent' });
  (markExecutionSkipped as jest.Mock).mockResolvedValue(null);
  (markExecutionFailed as jest.Mock).mockResolvedValue(null);
  (recordAcceptanceTx as jest.Mock).mockResolvedValue({
    advanced: true,
    nextDedupeKey: 'next-key',
  });
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
  else process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = originalFlag;
});

describe('durable dispatch', () => {
  it('claims transactionally, sends, and persists the next intent after commit', async () => {
    await handleDispatch(durableJob);

    expect(claimDueStepExecutionTx).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: durableJob.executionId, expectedGeneration: 0 }),
    );
    expect(createLog).toHaveBeenCalled();
    // Acceptance, advancement, and the next intent commit in one transaction;
    // publication follows the commit (not a legacy follow-up job).
    expect(recordAcceptanceTx).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: durableJob.executionId,
        next: expect.objectContaining({ stepNumber: 2 }),
      }),
    );
    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: expect.any(String) }),
      expect.anything(),
    );
    expect(enqueueOutreachFollowUp).not.toHaveBeenCalled();
  });

  it('parks execution-owned jobs while the flag is off instead of legacy-sending', async () => {
    delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
    try {
      await handleDispatch(durableJob);

      // Parked: nothing sent, no legacy follow-up, durable state untouched.
      expect(createLog).not.toHaveBeenCalled();
      expect(dispatchOutbound).not.toHaveBeenCalled();
      expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
      expect(enqueueOutreachFollowUp).not.toHaveBeenCalled();
      expect(markExecutionSkipped).not.toHaveBeenCalled();
      expect(claimDueStepExecutionTx).not.toHaveBeenCalled();
    } finally {
      process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    }
  });

  it('uses the execution row dispatch mode instead of converting mock work', async () => {
    (findExecutionByDedupeKey as jest.Mock).mockResolvedValue({
      dedupe_key: durableJob.executionId,
      snapshot_id: 'snap-1',
      step_number: 1,
      generation: 0,
      state: 'scheduled',
      mock_mode: true,
    });
    await handleDispatch({ ...durableJob, mockMode: false });

    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ mockMode: true }),
      expect.anything(),
    );
  });

  it('pause racing with a dispatch claim: stale generations never send', async () => {
    (getEnrollmentState as jest.Mock).mockResolvedValue({
      enrollment_status: 'active',
      scheduling_generation: 2,
    });
    await handleDispatch(durableJob);

    expect(claimDueStepExecutionTx).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
    expect(dispatchOutbound).not.toHaveBeenCalled();
    expect(markExecutionSkipped).toHaveBeenCalledWith(
      durableJob.executionId,
      expect.stringContaining('stale'),
    );
  });

  it('duplicate delivery attempts lose the claim race and exit quietly', async () => {
    (claimDueStepExecutionTx as jest.Mock).mockResolvedValue(null);
    await handleDispatch(durableJob);

    expect(createLog).not.toHaveBeenCalled();
    expect(dispatchOutbound).not.toHaveBeenCalled();
  });

  it('missing durable intents are stale jobs and never send', async () => {
    (findExecutionByDedupeKey as jest.Mock).mockResolvedValue(null);
    await handleDispatch(durableJob);

    expect(claimDueStepExecutionTx).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
  });

  it('records definite failures durably without throwing for BullMQ retries', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue({
      id: 'tmpl-1',
      approval_status: 'approved',
      subject: 'Hi',
    });
    (findLeadById as jest.Mock).mockResolvedValue({
      id: 'lead-1',
      email: 'a@b.com',
      phone: '+1',
      status: 'active',
    });
    (personalizeMessage as jest.Mock).mockResolvedValue({ message: 'Hello' });
    (dispatchOutbound as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'SendGrid down',
      latencyMs: 5,
    });

    await handleDispatch({ ...durableJob, mockMode: false });

    expect(markExecutionFailed).toHaveBeenCalledWith(
      durableJob.executionId,
      'provider_error',
      'SendGrid down',
    );
    // No next-step intent after a failure.
    expect(recordAcceptanceTx).not.toHaveBeenCalled();
  });

  it('uses the pinned snapshot even after the live sequence changed', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue({
      id: 'seq-1',
      steps: [{ stepNumber: 1, channel: 'sms', delayHours: 0, templateId: 'tmpl-9' }],
    });
    await handleDispatch(durableJob);

    expect(findSequenceById).not.toHaveBeenCalled();
    expect(createLog).toHaveBeenCalledWith(expect.objectContaining({ channel: 'email' }));
  });

  it('defers without consuming capacity when the cap is already reached', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, daily_send_limit: 1 });
    (countSentTodayForCampaign as jest.Mock).mockResolvedValue(1);

    await handleDispatch(durableJob);

    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: durableJob.executionId }),
      expect.objectContaining({ delayMs: expect.any(Number) }),
    );
    expect(createLog).not.toHaveBeenCalled();
    expect(reserveDailyCapacity).not.toHaveBeenCalled();
    expect(releaseExecutionClaim).toHaveBeenCalledWith(durableJob.executionId, expect.any(String));
    const deferredDueAt = (releaseExecutionClaim as jest.Mock).mock.calls[0][1];
    expect(new Date(deferredDueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('reserves one slot before sending when capped', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, daily_send_limit: 10 });
    (reserveDailyCapacity as jest.Mock).mockResolvedValue(true);

    await handleDispatch(durableJob);

    expect(reserveDailyCapacity).toHaveBeenCalledWith('camp-1', expect.any(String), 10, 0);
    expect(createLog).toHaveBeenCalled();
  });

  it('blocks the send and preserves pre-send state when reservation fails', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, daily_send_limit: 10 });
    (countSentTodayForCampaign as jest.Mock).mockResolvedValue(2);
    (reserveDailyCapacity as jest.Mock).mockRejectedValue(new Error('connection reset'));

    await handleDispatch(durableJob);

    // Fail closed: no connector call, claim released back to scheduled,
    // execution never marked failed or uncertain (pre-network failure).
    expect(dispatchOutbound).not.toHaveBeenCalled();
    expect(createLog).not.toHaveBeenCalled();
    expect(markExecutionFailed).not.toHaveBeenCalled();
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
    expect(releaseExecutionClaim).toHaveBeenCalledWith(durableJob.executionId, undefined);
  });

  it('defers when a concurrent worker wins the last capacity slot', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, daily_send_limit: 10 });
    (countSentTodayForCampaign as jest.Mock).mockResolvedValue(9);
    (reserveDailyCapacity as jest.Mock).mockResolvedValue(false);

    await handleDispatch(durableJob);

    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: durableJob.executionId }),
      expect.objectContaining({ delayMs: expect.any(Number) }),
    );
    expect(createLog).not.toHaveBeenCalled();
  });
});

describe('durable follow-up', () => {
  it('does not schedule follow-up work for a paused campaign', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue({
      id: 'seq-1',
      steps: [
        { stepNumber: 1, channel: 'email', templateId: 'tmpl-1' },
        { stepNumber: 2, channel: 'email', templateId: 'tmpl-2' },
      ],
    });
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, status: 'paused' });

    await handleFollowUp({
      leadId: 'lead-1',
      campaignId: 'camp-1',
      sequenceId: 'seq-1',
      previousStepNumber: 1,
      nextStepNumber: 2,
      delayHours: 24,
      mockMode: true,
    });

    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });
});
