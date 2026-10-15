/**
 * Campaign execution service — decision coverage with mocked persistence.
 *
 * Verifies the required backend behavior that needs no live database:
 * authoritative gating, idempotent intents, retry-while-paused, stale and
 * duplicate execution handling, capacity serialization, pause freeze,
 * resume restoration, recovery sweep outcomes, and phone-task progression.
 */
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../workers/queue', () => ({
  enqueueOutreachDispatch: jest.fn(),
  buildTransportJobId: jest.requireActual('../../workers/queue').buildTransportJobId,
  getOutreachDispatchJob: jest.fn(),
}));
jest.mock('./campaigns.repository', () => ({
  findCampaignById: jest.fn(),
  countSentTodayForCampaign: jest.fn(),
  findCampaignLeadRows: jest.fn(),
}));
jest.mock('./campaigns.execution.repository', () => ({
  buildDedupeKey: jest.requireActual('./campaigns.execution.repository').buildDedupeKey,
  claimDueStepExecutionTx: jest.fn(),
  completeEnrollmentAfterPhoneTaskTx: jest.fn(),
  enrollIntentTx: jest.fn(),
  findExpiredLeaseExecutions: jest.fn(),
  findLatestSnapshot: jest.fn(),
  findLatestStepExecution: jest.fn(),
  findPendingExecution: jest.fn(),
  findSnapshotById: jest.fn(),
  findStaleScheduledExecutions: jest.fn(),
  findUnscheduledDueExecutions: jest.fn(),
  getEnrollmentState: jest.fn(),
  hasDurableEnrollment: jest.fn(),
  insertStepExecution: jest.fn(),
  markExecutionFailed: jest.fn(),
  markExecutionSent: jest.fn(),
  markExecutionSkipped: jest.fn(),
  markExecutionTransportScheduled: jest.fn(),
  markExecutionUncertain: jest.fn(),
  pauseCampaignTx: jest.fn(),
  recordAcceptanceTx: jest.fn(),
  releaseDailyCapacity: jest.fn(),
  reserveDailyCapacity: jest.fn(),
  restoreIntentTx: jest.fn(),
  resumeEnrollmentTx: jest.fn(),
  upsertEnrollmentState: jest.fn(),
  ensureSequenceSnapshot: jest.fn(),
}));
jest.mock('../outreach/outreach.repository', () => ({
  findSequenceById: jest.fn(),
  findLogsByLead: jest.fn(),
}));
jest.mock('../templates/templates.repository', () => ({
  findTemplateById: jest.fn(),
}));
jest.mock('../leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));

import { enqueueOutreachDispatch, getOutreachDispatchJob } from '../../workers/queue';
import {
  findCampaignById,
  countSentTodayForCampaign,
  findCampaignLeadRows,
} from './campaigns.repository';
import {
  claimDueStepExecutionTx,
  completeEnrollmentAfterPhoneTaskTx,
  enrollIntentTx,
  ensureSequenceSnapshot,
  findExpiredLeaseExecutions,
  findLatestSnapshot,
  findLatestStepExecution,
  findPendingExecution,
  findSnapshotById,
  findStaleScheduledExecutions,
  findUnscheduledDueExecutions,
  getEnrollmentState,
  hasDurableEnrollment,
  insertStepExecution,
  markExecutionSent,
  markExecutionUncertain,
  markExecutionSkipped,
  markExecutionTransportScheduled,
  recordAcceptanceTx,
  reserveDailyCapacity,
  restoreIntentTx,
  resumeEnrollmentTx,
  upsertEnrollmentState,
} from './campaigns.execution.repository';
import { findLogsByLead, findSequenceById } from '../outreach/outreach.repository';
import { findTemplateById } from '../templates/templates.repository';
import { findLeadById } from '../leads/leads.repository';
import {
  evaluateDispatchGate,
  enrollWithIntent,
  publishExecution,
  createRetryIntent,
  recordAcceptance,
  restoreForResume,
  resumeSingleEnrollment,
  sweepRecovery,
  scheduleAfterPhoneTask,
  campaignLocalDate,
  tryReserveCapacity,
  claimExecutionForWorker,
  resolveExecutionSteps,
} from './campaigns.execution.service';

const activeCampaign = {
  id: 'camp-1',
  status: 'active',
  send_window_enabled: false,
  send_window_start_hour: 9,
  send_window_end_hour: 18,
  send_window_days: [1, 2, 3, 4, 5],
  send_window_timezone: 'UTC',
  daily_send_limit: null,
};

const steps = [
  { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: 'tmpl-1' },
  { stepNumber: 2, channel: 'email' as const, delayHours: 24, templateId: 'tmpl-2' },
];

const originalFlag = process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;

function enableDurable(): void {
  process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
  (findCampaignById as jest.Mock).mockResolvedValue(activeCampaign);
  (findCampaignLeadRows as jest.Mock).mockResolvedValue([{ id: 'lead-1' }]);
  (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1', status: 'active' });
  (findLogsByLead as jest.Mock).mockResolvedValue([]);
  (findTemplateById as jest.Mock).mockResolvedValue({ id: 'tmpl-1', approval_status: 'approved' });
  (countSentTodayForCampaign as jest.Mock).mockResolvedValue(0);
});

afterEach(() => {
  if (originalFlag === undefined) delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
  else process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = originalFlag;
});

describe('evaluateDispatchGate', () => {
  it('approves an eligible send', async () => {
    (getEnrollmentState as jest.Mock).mockRejectedValue(new Error('no tables'));
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toEqual({ eligible: true, reason: null });
  });

  it('blocks deleted or inactive campaigns', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'campaign_inactive' });
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, status: 'paused' });
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'campaign_inactive' });
  });

  it('blocks unenrolled leads', async () => {
    (findCampaignLeadRows as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'not_enrolled' });
  });

  it('keeps enrollment pauses independent from campaign state', async () => {
    enableDurable();
    (getEnrollmentState as jest.Mock).mockResolvedValue({
      enrollment_status: 'paused',
      scheduling_generation: 0,
    });
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'enrollment_paused' });
  });

  it('rejects stale generations after pause/resume', async () => {
    enableDurable();
    (getEnrollmentState as jest.Mock).mockResolvedValue({
      enrollment_status: 'active',
      scheduling_generation: 3,
    });
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
        expectedGeneration: 2,
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'stale_generation' });
  });

  it('blocks ineligible leads, replies, and unapproved templates', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1', status: 'opted_out' });
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'lead_ineligible' });

    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1', status: 'active' });
    (findLogsByLead as jest.Mock).mockResolvedValue([
      { campaign_id: 'camp-1', status: 'replied', replied_at: '2026-10-01T00:00:00Z' },
    ]);
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'lead_ineligible' });

    (findLogsByLead as jest.Mock).mockResolvedValue([]);
    (findTemplateById as jest.Mock).mockResolvedValue({ id: 'tmpl-1', approval_status: 'pending' });
    await expect(
      evaluateDispatchGate({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        stepNumber: 1,
        templateId: 'tmpl-1',
      }),
    ).resolves.toMatchObject({ eligible: false, reason: 'template_unapproved' });
  });
});

describe('campaignLocalDate / tryReserveCapacity', () => {
  it('computes the campaign-local day across timezones', () => {
    expect(campaignLocalDate('UTC', new Date('2026-10-13T23:30:00.000Z'))).toBe('2026-10-13');
    expect(campaignLocalDate('Asia/Kolkata', new Date('2026-10-13T19:00:00.000Z'))).toBe(
      '2026-10-14',
    );
  });

  it('skips reservation without a limit and reserves atomically with one', async () => {
    await expect(tryReserveCapacity(activeCampaign as never)).resolves.toBe(true);
    expect(reserveDailyCapacity).not.toHaveBeenCalled();
    (reserveDailyCapacity as jest.Mock).mockResolvedValue(false);
    await expect(
      tryReserveCapacity({ ...activeCampaign, daily_send_limit: 1 } as never),
    ).resolves.toBe(false);
    expect(reserveDailyCapacity).toHaveBeenCalledWith('camp-1', expect.any(String), 1);
  });
});

describe('enrollWithIntent', () => {
  it('stays on the legacy path while the flag is off', async () => {
    await expect(
      enrollWithIntent({
        campaign: activeCampaign as never,
        leadId: 'lead-1',
        steps,
        sequenceId: 'seq-1',
      }),
    ).resolves.toEqual({ durable: false, snapshotId: null, dedupeKey: null, due: null });
    expect(insertStepExecution).not.toHaveBeenCalled();
  });

  it('pins the sequence and persists a first-step intent when enabled', async () => {
    enableDurable();
    (getEnrollmentState as jest.Mock).mockResolvedValue(null);
    (findLatestSnapshot as jest.Mock).mockResolvedValue(null);
    (ensureSequenceSnapshot as jest.Mock).mockResolvedValue({ id: 'snap-1', steps });
    (upsertEnrollmentState as jest.Mock).mockResolvedValue({ scheduling_generation: 0 });
    (enrollIntentTx as jest.Mock).mockResolvedValue({ dedupeKey: 'cmp:key', inserted: true });

    const intent = await enrollWithIntent({
      campaign: activeCampaign as never,
      leadId: 'lead-1',
      steps,
      sequenceId: 'seq-1',
      mockMode: true,
    });
    expect(intent.durable).toBe(true);
    expect(intent.snapshotId).toBe('snap-1');
    expect(intent.dedupeKey).toBe('cmp:key');
    // Enrollment and first intent commit together, preserving dispatch mode.
    expect(enrollIntentTx).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: 'snap-1', generation: 0, mockMode: true }),
    );
    expect(insertStepExecution).not.toHaveBeenCalled();
  });

  it('rejects a nonzero first-step delay instead of silently ignoring it', async () => {
    enableDurable();
    await expect(
      enrollWithIntent({
        campaign: activeCampaign as never,
        leadId: 'lead-1',
        steps: [{ ...steps[0], delayHours: 5 }],
        sequenceId: 'seq-1',
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('publishExecution', () => {
  it('refuses to publish while the rollout flag is off', async () => {
    await expect(
      publishExecution({
        dedupeKey: 'k',
        leadId: 'lead-1',
        campaignId: 'camp-1',
        sequenceId: 'seq-1',
        stepNumber: 1,
        channel: 'email',
        templateId: 'tmpl-1',
        generation: 0,
        delayMs: 0,
        mockMode: false,
      }),
    ).resolves.toEqual({ published: false });
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('marks transport scheduled only after the queue accepts the job', async () => {
    enableDurable();
    const base = {
      dedupeKey: 'cmp:camp-1:lead-1',
      leadId: 'lead-1',
      campaignId: 'camp-1',
      sequenceId: 'seq-1',
      stepNumber: 1,
      channel: 'email' as const,
      templateId: 'tmpl-1',
      generation: 0,
      delayMs: 0,
      mockMode: false,
    };
    (enqueueOutreachDispatch as jest.Mock).mockResolvedValue(undefined);
    await expect(publishExecution(base)).resolves.toEqual({ published: true });
    expect(markExecutionTransportScheduled).toHaveBeenCalled();

    (enqueueOutreachDispatch as jest.Mock).mockRejectedValueOnce(new Error('Redis down'));
    await expect(publishExecution(base)).resolves.toEqual({ published: false });
  });
});

describe('createRetryIntent', () => {
  const retryBase = {
    campaign: activeCampaign as never,
    leadId: 'lead-1',
    stepNumber: 1,
    channel: 'email' as const,
    templateId: 'tmpl-1',
    generation: 0,
    snapshotId: null,
    existingPending: null,
  };

  it('rejects retry while the campaign is paused', async () => {
    await expect(
      createRetryIntent({
        ...retryBase,
        campaign: { ...activeCampaign, status: 'paused' } as never,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('is idempotent against double-clicks', async () => {
    const pending = { dedupe_key: 'pending-1', mock_mode: false };
    await expect(
      createRetryIntent({ ...retryBase, existingPending: pending as never }),
    ).resolves.toEqual({ dedupeKey: 'pending-1', duplicate: true, attempt: null, mockMode: false });
    expect(insertStepExecution).not.toHaveBeenCalled();
  });

  it('allocates attempt 1 after the original failure', async () => {
    (findLatestStepExecution as jest.Mock).mockResolvedValue({
      dedupe_key: 'cmp:camp-1:lead-1:legacy:s1:g0:a0',
      state: 'failed',
      mock_mode: true,
      snapshot_id: 'snap-1',
    });
    const { findPendingExecution } = await import('./campaigns.execution.service');
    void findPendingExecution;
    (insertStepExecution as jest.Mock).mockResolvedValue({ id: 'exec-2' });
    const result = await createRetryIntent(retryBase);
    expect(result).toEqual(
      expect.objectContaining({ duplicate: false, attempt: 1, mockMode: true }),
    );
    expect(result.dedupeKey).toContain('camp-1');
    expect(insertStepExecution).toHaveBeenCalledWith(
      expect.objectContaining({ mockMode: true, attempt: 1, snapshotId: 'snap-1' }),
    );
  });

  it('allocates attempt 2 after retry 1 fails instead of silently conflicting', async () => {
    (findLatestStepExecution as jest.Mock).mockResolvedValue({
      dedupe_key: 'cmp:camp-1:lead-1:snap-1:s1:g0:a1',
      state: 'failed',
      mock_mode: false,
      snapshot_id: 'snap-1',
    });
    (insertStepExecution as jest.Mock).mockResolvedValue({ id: 'exec-3' });
    const result = await createRetryIntent(retryBase);
    expect(result).toEqual(expect.objectContaining({ duplicate: false, attempt: 2 }));
    expect(result.dedupeKey).toContain(':a2');
  });

  it('collapses a concurrent winner into a duplicate', async () => {
    (findLatestStepExecution as jest.Mock).mockResolvedValue({
      dedupe_key: 'cmp:camp-1:lead-1:snap-1:s1:g0:a0',
      state: 'failed',
      mock_mode: false,
      snapshot_id: null,
    });
    (insertStepExecution as jest.Mock).mockResolvedValue(null);
    (findPendingExecution as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({
      dedupe_key: 'winner-key',
      mock_mode: false,
    });
    const result = await createRetryIntent(retryBase);
    expect(result).toEqual(
      expect.objectContaining({ dedupeKey: 'winner-key', duplicate: true, attempt: null }),
    );
  });

  it('never retries an uncertain delivery automatically', async () => {
    (findLatestStepExecution as jest.Mock).mockResolvedValue({
      dedupe_key: 'cmp:camp-1:lead-1:snap-1:s1:g0:a0',
      state: 'uncertain',
      mock_mode: false,
      snapshot_id: null,
    });
    await expect(createRetryIntent(retryBase)).rejects.toMatchObject({ statusCode: 422 });
    expect(insertStepExecution).not.toHaveBeenCalled();
  });

  it('refuses to retry an already-sent step', async () => {
    (findLatestStepExecution as jest.Mock).mockResolvedValue({
      dedupe_key: 'cmp:camp-1:lead-1:snap-1:s1:g0:a0',
      state: 'sent',
      mock_mode: false,
      snapshot_id: null,
    });
    await expect(createRetryIntent(retryBase)).rejects.toMatchObject({ statusCode: 409 });
    expect(insertStepExecution).not.toHaveBeenCalled();
  });

  it('refuses retry when lead is opted out', async () => {
    (findLeadById as jest.Mock).mockResolvedValueOnce({ id: 'lead-1', status: 'opted_out' });
    await expect(createRetryIntent(retryBase)).rejects.toMatchObject({ statusCode: 400 });
    expect(insertStepExecution).not.toHaveBeenCalled();
  });

  it('refuses retry when enrollment is paused', async () => {
    (getEnrollmentState as jest.Mock).mockResolvedValueOnce({ enrollment_status: 'paused' });
    await expect(createRetryIntent(retryBase)).rejects.toMatchObject({ statusCode: 409 });
    expect(insertStepExecution).not.toHaveBeenCalled();
  });

  it('throws 409 when conflict occurs and no execution is pending', async () => {
    (findLatestStepExecution as jest.Mock).mockResolvedValue({
      dedupe_key: 'cmp:camp-1:lead-1:snap-1:s1:g0:a0',
      state: 'failed',
      mock_mode: false,
      snapshot_id: null,
    });
    (insertStepExecution as jest.Mock).mockResolvedValue(null);
    (findPendingExecution as jest.Mock).mockResolvedValue(null);
    await expect(createRetryIntent(retryBase)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('nothing was scheduled'),
    });
  });
});

describe('recordAcceptance', () => {
  const enrollment = {
    campaign_id: 'camp-1',
    lead_id: 'lead-1',
    scheduling_generation: 0,
    completed_steps: 0,
    sequence_snapshot_id: 'snap-1',
  };
  const execution = {
    dedupe_key: 'exec-1',
    step_number: 1,
    snapshot_id: 'snap-1',
    state: 'claimed',
  };

  it('completes the enrollment when no steps remain', async () => {
    (recordAcceptanceTx as jest.Mock).mockResolvedValue({ advanced: true, nextDedupeKey: null });
    await recordAcceptance({
      campaign: activeCampaign as never,
      enrollment: enrollment as never,
      execution: execution as never,
      providerMsgId: 'ext-1',
      steps: [steps[0]],
      sequenceId: 'seq-1',
      mockMode: false,
    });
    expect(recordAcceptanceTx).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: 'exec-1',
        providerMsgId: 'ext-1',
        completedSteps: 1,
        terminalStopReason: 'sequence_completed',
        next: null,
      }),
    );
    // No next intent means no publication.
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('persists acceptance plus the next intent atomically, then publishes', async () => {
    enableDurable();
    (recordAcceptanceTx as jest.Mock).mockResolvedValue({
      advanced: true,
      nextDedupeKey: 'next-key',
    });
    (enqueueOutreachDispatch as jest.Mock).mockResolvedValue(undefined);
    await recordAcceptance({
      campaign: activeCampaign as never,
      enrollment: enrollment as never,
      execution: { ...execution, mock_mode: true } as never,
      providerMsgId: 'ext-1',
      steps,
      sequenceId: 'seq-1',
      mockMode: true,
      acceptedAt: new Date('2026-10-13T10:00:00.000Z'),
    });
    expect(recordAcceptanceTx).toHaveBeenCalledWith(
      expect.objectContaining({
        next: expect.objectContaining({ stepNumber: 2 }),
      }),
    );
    // Published after commit with the accepted execution's dispatch mode.
    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ mockMode: true }),
      expect.anything(),
    );
  });

  it('does not publish when the transaction did not advance', async () => {
    (recordAcceptanceTx as jest.Mock).mockResolvedValue({ advanced: false, nextDedupeKey: null });
    await recordAcceptance({
      campaign: activeCampaign as never,
      enrollment: enrollment as never,
      execution: execution as never,
      providerMsgId: 'ext-1',
      steps,
      sequenceId: 'seq-1',
      mockMode: false,
    });
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });
});

describe('restoreForResume', () => {
  it('restores enrolled work atomically without touching paused leads', async () => {
    enableDurable();
    (countSentTodayForCampaign as jest.Mock).mockResolvedValue(0);
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: 'snap-1',
      sequence_id: 'seq-1',
      steps,
    });
    (restoreIntentTx as jest.Mock).mockResolvedValue({ nextDedupeKey: 'restored-key' });
    (enqueueOutreachDispatch as jest.Mock).mockResolvedValue(undefined);
    const result = await restoreForResume({
      campaign: activeCampaign as never,
      enrollments: [
        {
          campaign_id: 'camp-1',
          lead_id: 'lead-1',
          enrollment_status: 'active',
          sequence_snapshot_id: 'snap-1',
          next_step_number: 2,
          next_due_at: null,
          delay_remaining_ms: '1200000',
          completed_steps: 1,
          scheduling_generation: 1,
          timing_unknown: false,
        },
        {
          campaign_id: 'camp-1',
          lead_id: 'lead-2',
          enrollment_status: 'paused',
          sequence_snapshot_id: 'snap-1',
          next_step_number: 2,
          next_due_at: null,
          delay_remaining_ms: '600000',
          completed_steps: 1,
          scheduling_generation: 1,
          timing_unknown: false,
        },
        {
          campaign_id: 'camp-1',
          lead_id: 'lead-3',
          enrollment_status: 'active',
          sequence_snapshot_id: null,
          next_step_number: 2,
          next_due_at: null,
          delay_remaining_ms: null,
          completed_steps: 1,
          scheduling_generation: 1,
          timing_unknown: true,
        },
      ] as never,
      resumedAt: new Date('2026-10-13T10:00:00.000Z'),
    });
    expect(result.restored).toBe(1);
    expect(result.unknownTiming).toBe(1);
    // Timing and intent commit together via the restore transaction,
    // keeping the enrollment's dispatch mode.
    expect(restoreIntentTx).toHaveBeenCalledTimes(1);
    expect(restoreIntentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        execution: expect.objectContaining({ stepNumber: 2, mockMode: false }),
      }),
    );
  });
});

describe('resumeSingleEnrollment', () => {
  const pausedEnrollment = {
    campaign_id: 'camp-1',
    lead_id: 'lead-1',
    enrollment_status: 'paused',
    sequence_snapshot_id: 'snap-1',
    next_step_number: 2,
    next_due_at: null,
    delay_remaining_ms: '1200000',
    completed_steps: 1,
    scheduling_generation: 1,
    timing_unknown: false,
    mock_mode: false,
  };

  it('restores the frozen remainder through the shared scheduling rules', async () => {
    enableDurable();
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: 'snap-1',
      sequence_id: 'seq-1',
      steps,
    });
    (resumeEnrollmentTx as jest.Mock).mockResolvedValue({
      enrollment: {
        enrollment_status: 'active',
        next_due_at: '2026-10-13T10:20:00.000Z',
        scheduling_generation: 2,
      },
      nextDedupeKey: 'resume-key',
    });
    (enqueueOutreachDispatch as jest.Mock).mockResolvedValue(undefined);
    const result = await resumeSingleEnrollment({
      campaign: activeCampaign as never,
      enrollment: pausedEnrollment as never,
      resumedAt: new Date('2026-10-13T10:00:00.000Z'),
      sequenceId: 'seq-1',
    });
    expect(result).toEqual({
      status: 'active',
      nextDueAt: '2026-10-13T10:20:00.000Z',
      nextDedupeKey: 'resume-key',
    });
    // 20 frozen minutes recomputed from the resume instant, then published
    // with the new generation.
    expect(resumeEnrollmentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedGeneration: 1,
        computedDueAt: '2026-10-13T10:20:00.000Z',
        execution: expect.objectContaining({ stepNumber: 2, mockMode: false }),
      }),
    );
    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 2 }),
      expect.anything(),
    );
  });

  it('uses an explicit schedule for unknown timing', async () => {
    enableDurable();
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: 'snap-1',
      sequence_id: 'seq-1',
      steps,
    });
    (resumeEnrollmentTx as jest.Mock).mockResolvedValue({
      enrollment: {
        enrollment_status: 'active',
        next_due_at: '2026-10-20T09:00:00.000Z',
        scheduling_generation: 2,
      },
      nextDedupeKey: 'resume-key-2',
    });
    (enqueueOutreachDispatch as jest.Mock).mockResolvedValue(undefined);
    const result = await resumeSingleEnrollment({
      campaign: activeCampaign as never,
      enrollment: { ...pausedEnrollment, timing_unknown: true, delay_remaining_ms: null } as never,
      explicitDueAt: '2026-10-20T09:00:00.000Z',
    });
    expect(result.nextDueAt).toBe('2026-10-20T09:00:00.000Z');
  });

  it('requires an explicit schedule when timing was lost', async () => {
    await expect(
      resumeSingleEnrollment({
        campaign: activeCampaign as never,
        enrollment: {
          ...pausedEnrollment,
          timing_unknown: true,
          delay_remaining_ms: null,
        } as never,
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('reports a conflict when the version moved (duplicate resume)', async () => {
    (resumeEnrollmentTx as jest.Mock).mockResolvedValue(null);
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: 'snap-1',
      sequence_id: 'seq-1',
      steps,
    });
    await expect(
      resumeSingleEnrollment({
        campaign: activeCampaign as never,
        enrollment: pausedEnrollment as never,
        resumedAt: new Date('2026-10-13T10:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('sweepRecovery', () => {
  it('republishes orphaned and parked intents and marks expired leases uncertain', async () => {
    enableDurable();
    (findUnscheduledDueExecutions as jest.Mock).mockResolvedValue([
      {
        dedupe_key: 'orphan-1',
        campaign_id: 'camp-1',
        lead_id: 'lead-1',
        step_number: 1,
        channel: 'email',
        template_id: 'tmpl-1',
        generation: 0,
        snapshot_id: null,
        mock_mode: true,
        due_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    (findStaleScheduledExecutions as jest.Mock).mockResolvedValue([
      {
        dedupe_key: 'parked-1',
        campaign_id: 'camp-1',
        lead_id: 'lead-2',
        step_number: 1,
        channel: 'email',
        template_id: 'tmpl-1',
        generation: 0,
        snapshot_id: null,
        mock_mode: false,
        due_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ]);
    (findExpiredLeaseExecutions as jest.Mock).mockResolvedValue([
      { dedupe_key: 'crashed-1', campaign_id: 'camp-1', lead_id: 'lead-9', claimed_by: 'w-1' },
    ]);
    (getEnrollmentState as jest.Mock).mockResolvedValue({ enrollment_status: 'active' });
    (enqueueOutreachDispatch as jest.Mock).mockResolvedValue(undefined);
    (markExecutionUncertain as jest.Mock).mockResolvedValue({});

    const result = await sweepRecovery({ limit: 10 });
    expect(result).toEqual({ republished: 2, uncertain: 1 });
    // Uncertain — never an automatic resend of a possibly accepted message.
    expect(enqueueOutreachDispatch).toHaveBeenCalledTimes(2);
    // Mock mode is preserved from the persisted row, not reset to real.
    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1', mockMode: true }),
      expect.anything(),
    );
    expect(markExecutionUncertain).toHaveBeenCalledWith(
      'crashed-1',
      expect.stringContaining('lease expired'),
    );
  });

  it('skips recovery work for campaigns that are no longer active', async () => {
    enableDurable();
    (findUnscheduledDueExecutions as jest.Mock).mockResolvedValue([
      {
        dedupe_key: 'orphan-2',
        campaign_id: 'camp-9',
        lead_id: 'lead-1',
        step_number: 1,
        channel: 'email',
        template_id: 'tmpl-1',
        generation: 0,
        snapshot_id: null,
        mock_mode: false,
        due_at: null,
      },
    ]);
    (findStaleScheduledExecutions as jest.Mock).mockResolvedValue([]);
    (findExpiredLeaseExecutions as jest.Mock).mockResolvedValue([]);
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, status: 'paused' });
    const result = await sweepRecovery({ limit: 10 });
    expect(result.republished).toBe(0);
    expect(markExecutionSkipped).toHaveBeenCalledWith('orphan-2', expect.any(String));
  });
});

describe('scheduleAfterPhoneTask', () => {
  it('stays legacy while the flag is off', async () => {
    (hasDurableEnrollment as jest.Mock).mockResolvedValue(false);
    await expect(
      scheduleAfterPhoneTask({
        campaign: activeCampaign as never,
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        completedStepNumber: 1,
      }),
    ).resolves.toEqual({ owned: false, scheduled: false, duplicate: false });
  });

  it('schedules from the pinned snapshot and treats duplicate completions as duplicates with the flag off', async () => {
    enableDurable();
    (hasDurableEnrollment as jest.Mock).mockResolvedValue(true);
    (getEnrollmentState as jest.Mock).mockResolvedValue({
      enrollment_status: 'active',
      scheduling_generation: 0,
      sequence_snapshot_id: 'snap-1',
      completed_steps: 1,
      mock_mode: true,
    });
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: 'snap-1',
      steps: [steps[0], { ...steps[1], templateId: 'pinned-template' }],
    });
    delete process.env.CAMPAIGN_OPERATIONS_V2_ENABLED;
    (restoreIntentTx as jest.Mock).mockResolvedValueOnce({ nextDedupeKey: 'phone-next' });
    (enqueueOutreachDispatch as jest.Mock).mockResolvedValue(undefined);
    await expect(
      scheduleAfterPhoneTask({
        campaign: activeCampaign as never,
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        completedStepNumber: 1,
        completedAt: new Date('2026-10-13T10:00:00.000Z'),
      }),
    ).resolves.toEqual({ owned: true, scheduled: true, duplicate: false });
    // Enrollment mode and the immutable template are preserved in the next intent.
    expect(restoreIntentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: expect.objectContaining({
          stepNumber: 2,
          templateId: 'pinned-template',
          mockMode: true,
        }),
      }),
    );
    // With the rollout flag off, the next intent persists for the recovery
    // sweep and no transport job is published.
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();

    (restoreIntentTx as jest.Mock).mockResolvedValueOnce(null);
    await expect(
      scheduleAfterPhoneTask({
        campaign: activeCampaign as never,
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        completedStepNumber: 1,
      }),
    ).resolves.toEqual({ owned: true, scheduled: false, duplicate: true });
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('marks the enrollment complete when the task was the final step', async () => {
    (hasDurableEnrollment as jest.Mock).mockResolvedValue(true);
    (getEnrollmentState as jest.Mock).mockResolvedValue({
      enrollment_status: 'active',
      scheduling_generation: 0,
      sequence_snapshot_id: 'snap-1',
      completed_steps: 2,
      mock_mode: false,
    });
    (findSnapshotById as jest.Mock).mockResolvedValue({ id: 'snap-1', steps });
    (completeEnrollmentAfterPhoneTaskTx as jest.Mock).mockResolvedValue(true);
    await expect(
      scheduleAfterPhoneTask({
        campaign: activeCampaign as never,
        leadId: 'lead-1',
        sequenceId: 'seq-1',
        completedStepNumber: 2,
      }),
    ).resolves.toEqual({ owned: true, scheduled: false, duplicate: false });
    expect(completeEnrollmentAfterPhoneTaskTx).toHaveBeenCalledWith({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      completedStepNumber: 2,
      expectedGeneration: 0,
      completedSteps: 2,
    });
    expect(restoreIntentTx).not.toHaveBeenCalled();
  });
});

describe('claim / resolve helpers', () => {
  it('claims through to the repository and resolves snapshots first', async () => {
    enableDurable();
    (claimDueStepExecutionTx as jest.Mock).mockResolvedValue({ id: 'exec-1' });
    await expect(
      claimExecutionForWorker({ dedupeKey: 'exec-1', expectedGeneration: 0, workerId: 'w-1' }),
    ).resolves.toEqual({ id: 'exec-1' });

    (findSnapshotById as jest.Mock).mockResolvedValue({ id: 'snap-1', steps });
    await expect(
      resolveExecutionSteps({ snapshotId: 'snap-1', sequenceId: 'seq-1' }),
    ).resolves.toEqual(steps);
    expect(findSequenceById).not.toHaveBeenCalled();

    (findSnapshotById as jest.Mock).mockResolvedValue(null);
    (findSequenceById as jest.Mock).mockResolvedValue({ id: 'seq-1', steps });
    await expect(resolveExecutionSteps({ snapshotId: null, sequenceId: 'seq-1' })).resolves.toEqual(
      steps,
    );

    (findSequenceById as jest.Mock).mockResolvedValue(null);
    await expect(
      resolveExecutionSteps({ snapshotId: null, sequenceId: 'missing' }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
