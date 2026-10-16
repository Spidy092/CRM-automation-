/**
 * Campaign operations service — read-model and enrollment-control coverage.
 */
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('./campaigns.repository', () => ({
  findCampaignById: jest.fn(),
  countSentTodayForCampaign: jest.fn(),
  getCampaignStats: jest.fn(),
}));
jest.mock('./campaigns.execution.repository', () => ({
  countAttentionItems: jest.fn(),
  countExecutionsByState: jest.fn(),
  findCampaignActivity: jest.fn(),
  findCommittedSchedule: jest.fn(),
  findEnrollmentsPage: jest.fn(),
  findNextCommittedActivity: jest.fn(),
  findSnapshotById: jest.fn(),
  getEnrollmentState: jest.fn(),
  hasSentPhoneTaskStep: jest.fn().mockResolvedValue(false),
  summarizeEnrollmentStates: jest.fn(),
  pauseEnrollmentState: jest.fn(),
  resumeEnrollmentTx: jest.fn(),
  summarizeCampaigns: jest.fn(),
}));
jest.mock('../outreach/outreach.repository', () => ({
  findSequenceById: jest.fn(),
}));
jest.mock('../integrations/integrations.repository', () => ({
  findByName: jest.fn(),
}));
jest.mock('../leads/leads.service', () => ({
  getLeadById: jest.fn(),
  assertAccess: jest.fn(),
}));

import { findCampaignById, countSentTodayForCampaign, getCampaignStats } from './campaigns.repository';
import {
  countAttentionItems,
  countExecutionsByState,
  findCampaignActivity,
  findCommittedSchedule,
  findEnrollmentsPage,
  findNextCommittedActivity,
  findSnapshotById,
  getEnrollmentState,
  summarizeEnrollmentStates,
  pauseEnrollmentState,
  resumeEnrollmentTx,
  summarizeCampaigns,
} from './campaigns.execution.repository';
import { findSequenceById } from '../outreach/outreach.repository';
import { findByName } from '../integrations/integrations.repository';
import { getLeadById as getLeadByIdService } from '../leads/leads.service';
import {
  getCampaignOperations,
  getCampaignSchedule,
  getCampaignActivity,
  getCampaignEnrollments,
  pauseCampaignEnrollment,
  resumeCampaignEnrollment,
  getCampaignsSummary,
} from './campaigns.operations.service';

const campaign = {
  id: 'camp-1',
  name: 'Test',
  status: 'active',
  sequence_id: 'seq-1',
  send_window_enabled: false,
  send_window_start_hour: 9,
  send_window_end_hour: 18,
  send_window_days: [1, 2, 3, 4, 5],
  send_window_timezone: 'UTC',
  daily_send_limit: 50,
};

const actor = { id: 'admin-1', role: 'admin', ipAddress: null };
const steps = [
  { stepNumber: 1, channel: 'email', delayHours: 0, templateId: 'tmpl-1' },
  { stepNumber: 2, channel: 'email', delayHours: 24, templateId: 'tmpl-2' },
];

beforeEach(() => {
  jest.clearAllMocks();
  (findCampaignById as jest.Mock).mockResolvedValue(campaign);
  (findSequenceById as jest.Mock).mockResolvedValue({ id: 'seq-1', steps });
  (countSentTodayForCampaign as jest.Mock).mockResolvedValue(3);
  (getCampaignStats as jest.Mock).mockResolvedValue({
    total_leads: 2,
    sent: 3,
    delivered: 2,
    opened: 1,
    replied: 0,
    failed: 1,
  });
  (findByName as jest.Mock).mockResolvedValue({ is_enabled: true, last_test_status: 'ok' });
});

describe('getCampaignOperations', () => {
  it('answers what happens next, for how many, and why anything waits', async () => {
    (findNextCommittedActivity as jest.Mock).mockResolvedValue({
      due_at: '2026-10-13T12:30:00.000Z',
      lead_id: 'lead-1',
      step_number: 2,
      channel: 'email',
    });
    (countAttentionItems as jest.Mock).mockResolvedValue({ failed: '1', uncertain: '0', scheduled: '2' });
    (countExecutionsByState as jest.Mock).mockResolvedValue([
      { state: 'scheduled', channel: 'email', count: '2' },
    ]);
    (getLeadByIdService as jest.Mock).mockResolvedValue({ business_name: 'Acme' });
    (summarizeEnrollmentStates as jest.Mock).mockResolvedValue([
      { reason: null, count: '1', potential_remaining: '1', unknown_timing: '0' },
      { reason: 'enrollment_paused', count: '1', potential_remaining: '2', unknown_timing: '0' },
    ]);

    const overview = await getCampaignOperations('camp-1', actor);
    expect(overview.nextActivity).toMatchObject({
      kind: 'committed',
      leadId: 'lead-1',
      stepNumber: 2,
      channel: 'email',
      dueAt: '2026-10-13T12:30:00.000Z',
    });
    expect(overview.nextActivity?.dueLabel).toContain('UTC');
    expect(overview.scheduledCount).toBe(2);
    expect(overview.potentialRemaining).toBe(3); // (2-1) active + (2-0) paused
    expect(overview.sentToday).toBe(3);
    expect(overview.capacityRemaining).toBe(47);
    expect(overview.attempts).toBe(4);
    expect(overview.failedUnresolved).toBe(1);
    expect(overview.waitingReasons).toContainEqual({ reason: 'enrollment_paused', count: 1 });
    expect(overview.attention).toContainEqual({
      kind: 'failed',
      count: 1,
      label: expect.any(String),
    });
    expect(overview.computedAt).toBeDefined();
  });

  it('throws 404 for a missing campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(getCampaignOperations('missing', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reports unknown capacity as null without a limit', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...campaign, daily_send_limit: null });
    (findNextCommittedActivity as jest.Mock).mockResolvedValue(null);
    (countAttentionItems as jest.Mock).mockResolvedValue({ failed: '0', uncertain: '0', scheduled: '0' });
    (countExecutionsByState as jest.Mock).mockResolvedValue([]);
    (summarizeEnrollmentStates as jest.Mock).mockResolvedValue([]);
    const overview = await getCampaignOperations('camp-1', actor);
    expect(overview.nextActivity).toBeNull();
    expect(overview.capacityRemaining).toBeNull();
  });
});

describe('getCampaignSchedule', () => {
  it('separates committed executions from projected future steps', async () => {
    (findCommittedSchedule as jest.Mock).mockResolvedValue([
      {
        lead_id: 'lead-1',
        step_number: 2,
        channel: 'email',
        state: 'scheduled',
        due_at: '2026-10-13T12:30:00.000Z',
      },
    ]);
    (getLeadByIdService as jest.Mock).mockResolvedValue({ business_name: 'Acme' });
    (findEnrollmentsPage as jest.Mock).mockResolvedValue({
      rows: [
        {
          lead_id: 'lead-1',
          enrollment_status: 'active',
          next_step_number: 2,
          next_due_at: '2026-10-13T12:30:00.000Z',
        },
      ],
      hasMore: false,
    });
    const schedule = await getCampaignSchedule('camp-1', actor, { limit: 25 });
    expect(schedule.committed).toHaveLength(1);
    expect(schedule.committed[0]).toMatchObject({ stepNumber: 2, state: 'scheduled' });
    expect(schedule.committed[0].dueLabel).toContain('UTC');
    // No steps beyond step 2 in the fixture → no projections.
    expect(schedule.projected).toEqual([]);
  });
});

describe('getCampaignActivity', () => {
  it('pages operational history with cursors', async () => {
    (findCampaignActivity as jest.Mock).mockResolvedValue({
      rows: [
        {
          id: 'a1',
          kind: 'send',
          lead_id: 'lead-1',
          step_number: 1,
          channel: 'email',
          status: 'sent',
          created_at: '2026-10-13T10:00:00.000Z',
        },
      ],
      hasMore: true,
    });
    const activity = await getCampaignActivity('camp-1', actor, { limit: 25 });
    expect(activity.items).toHaveLength(1);
    expect(activity.meta.hasMore).toBe(true);
    expect(activity.meta.nextCursor).toBeTruthy();
  });

  it('rejects malformed cursors', async () => {
    await expect(getCampaignActivity('camp-1', actor, { limit: 25, cursor: '!!!' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

describe('getCampaignEnrollments', () => {
  const futureDue = new Date(Date.now() + 3_600_000).toISOString();
  const row = {
    lead_id: 'lead-1',
    contact_name: 'Sam',
    business_name: 'Acme',
    lead_status: 'active',
    enrollment_status: 'active',
    sequence_snapshot_id: null,
    next_step_number: 2,
    next_due_at: futureDue,
    delay_remaining_ms: null,
    completed_steps: 1,
    pause_reason: null,
    stop_reason: null,
    scheduling_generation: 0,
    timing_unknown: false,
    execution_updated_at: '2026-10-13T10:00:00.000Z',
    added_at: '2026-10-01T00:00:00.000Z',
    latest_step: 1,
    latest_status: 'sent',
    latest_time: '2026-10-13T10:00:00.000Z',
    latest_error: null,
    open_task_count: '0',
  };

  it('returns per-lead progress with committed next actions and permitted actions', async () => {
    (findEnrollmentsPage as jest.Mock).mockResolvedValue({ rows: [row], hasMore: false });
    const page = await getCampaignEnrollments('camp-1', actor, { limit: 25 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      leadId: 'lead-1',
      completedSteps: 1,
      totalSteps: 2,
      waitingReason: 'sequence_delay',
    });
    expect(page.items[0].nextAction).toMatchObject({ kind: 'committed', stepNumber: 2 });
    expect(page.items[0].nextAction?.dueLabel).toContain('UTC');
    expect(page.items[0].actions).toMatchObject({ pause: true, resume: false });
  });

  it('shows terminal reasons instead of countdowns', async () => {
    (findEnrollmentsPage as jest.Mock).mockResolvedValue({
      rows: [{ ...row, enrollment_status: 'stopped', stop_reason: 'opted_out', next_due_at: null, next_step_number: null }],
      hasMore: false,
    });
    const page = await getCampaignEnrollments('camp-1', actor, { limit: 25 });
    expect(page.items[0].terminalReason).toBe('opted_out');
    expect(page.items[0].nextAction).toBeNull();
    expect(page.items[0].waitingReason).toBeNull();
  });

  it('restricts sales actions to owned leads only at mutation time', async () => {
    (findEnrollmentsPage as jest.Mock).mockResolvedValue({ rows: [row], hasMore: false });
    const page = await getCampaignEnrollments(
      'camp-1',
      { id: 'sales-1', role: 'viewer', ipAddress: null },
      { limit: 25 },
    );
    expect(page.items[0].actions.pause).toBe(false);
  });
});

describe('pause / resume enrollment', () => {
  it('pauses with optimistic concurrency and audits', async () => {
    (pauseEnrollmentState as jest.Mock).mockResolvedValue({ enrollment_status: 'paused' });
    await expect(
      pauseCampaignEnrollment('camp-1', 'lead-1', actor, { expectedGeneration: 0, reason: 'break' }),
    ).resolves.toBe('paused');
    expect(pauseEnrollmentState).toHaveBeenCalledWith(
      'camp-1',
      'lead-1',
      'break',
      0,
      expect.any(String),
    );
  });

  it('reports a 409 conflict when the version moved', async () => {
    (pauseEnrollmentState as jest.Mock).mockResolvedValue(null);
    (getEnrollmentState as jest.Mock).mockResolvedValue({ enrollment_status: 'active', scheduling_generation: 1 });
    await expect(
      pauseCampaignEnrollment('camp-1', 'lead-1', actor, { expectedGeneration: 0 }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('requires an explicit schedule when timing was lost', async () => {
    (getEnrollmentState as jest.Mock).mockResolvedValue({
      enrollment_status: 'paused',
      timing_unknown: true,
      scheduling_generation: 2,
    });
    await expect(
      resumeCampaignEnrollment('camp-1', 'lead-1', actor, { expectedGeneration: 2 }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('keeps an enrollment paused until its campaign has resumed', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...campaign, status: 'paused' });
    await expect(
      resumeCampaignEnrollment('camp-1', 'lead-1', actor, { expectedGeneration: 2 }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(getEnrollmentState).not.toHaveBeenCalled();
    expect(resumeEnrollmentTx).not.toHaveBeenCalled();
  });

  it('resumes with an explicit schedule and a current-generation execution', async () => {
    (getEnrollmentState as jest.Mock).mockResolvedValue({
      campaign_id: 'camp-1',
      lead_id: 'lead-1',
      enrollment_status: 'paused',
      sequence_snapshot_id: 'snap-1',
      next_step_number: 2,
      next_due_at: null,
      delay_remaining_ms: null,
      completed_steps: 1,
      scheduling_generation: 2,
      timing_unknown: true,
      mock_mode: true,
    });
    (findSequenceById as jest.Mock).mockResolvedValue({ id: 'seq-1', steps: [] });
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: 'snap-1',
      sequence_id: 'seq-1',
      steps: [
        { stepNumber: 1, channel: 'email', delayHours: 0, templateId: 't1' },
        { stepNumber: 2, channel: 'sms', delayHours: 24, templateId: 't2' },
      ],
    });
    (resumeEnrollmentTx as jest.Mock).mockResolvedValue({
      enrollment: { enrollment_status: 'active', next_due_at: '2026-10-20T09:00:00.000Z', scheduling_generation: 3 },
      nextDedupeKey: 'resumed-key',
    });
    await expect(
      resumeCampaignEnrollment('camp-1', 'lead-1', actor, {
        expectedGeneration: 2,
        nextDueAt: '2026-10-20T09:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'active', nextDueAt: '2026-10-20T09:00:00.000Z' });
    // State transition and current-generation intent commit together,
    // keeping the enrollment's dispatch mode.
    expect(resumeEnrollmentTx).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        expectedGeneration: 2,
        computedDueAt: expect.any(String),
        execution: expect.objectContaining({ stepNumber: 2, channel: 'sms', mockMode: true }),
      }),
    );
  });

  it('rejects sales actors without ownership at the service boundary', async () => {
    const { assertAccess } = jest.requireMock('../leads/leads.service') as {
      assertAccess: jest.Mock;
    };
    (getLeadByIdService as jest.Mock).mockResolvedValue({ assigned_to: 'someone-else' });
    assertAccess.mockImplementation(() => {
      throw new (jest.requireActual('../../shared/middleware/errorHandler') as { AppError: new (m: string, c: number) => Error }).AppError('Forbidden', 403);
    });
    await expect(
      pauseCampaignEnrollment('camp-1', 'lead-1', { id: 'sales-1', role: 'sales', ipAddress: null }, { expectedGeneration: 0 }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('getCampaignsSummary', () => {
  it('returns one row per campaign from a single query', async () => {
    (summarizeCampaigns as jest.Mock).mockResolvedValue([
      { campaign_id: 'c1', scheduled: '2', failed: '1', uncertain: '0', next_due_at: '2026-10-13T12:30:00.000Z' },
    ]);
    const rows = await getCampaignsSummary(['c1', 'c1', 'c2'], actor);
    expect(summarizeCampaigns).toHaveBeenCalledWith(['c1', 'c2']);
    expect(rows).toEqual([
      { campaignId: 'c1', scheduled: 2, failed: 1, uncertain: 0, nextDueAt: '2026-10-13T12:30:00.000Z' },
    ]);
  });

  it('returns empty for no ids', async () => {
    await expect(getCampaignsSummary([], actor)).resolves.toEqual([]);
    expect(summarizeCampaigns).not.toHaveBeenCalled();
  });
});

describe('getCampaignOperations campaign-wide totals', () => {
  it('aggregates totals across more than 100 enrollments with mixed snapshots', async () => {
    (findNextCommittedActivity as jest.Mock).mockResolvedValue(null);
    (countAttentionItems as jest.Mock).mockResolvedValue({ failed: '0', uncertain: '0', scheduled: '5' });
    (countExecutionsByState as jest.Mock).mockResolvedValue([]);
    (summarizeEnrollmentStates as jest.Mock).mockResolvedValue([
      { reason: 'sequence_delay', count: '120', potential_remaining: '310', unknown_timing: '0' },
    ]);

    const overview = await getCampaignOperations('camp-1', actor);
    // 70 × (4−1) + 50 × (2−0) = 310, not the 300 a 100-row page would give.
    expect(overview.potentialRemaining).toBe(310);
    expect(overview.scheduledCount).toBe(5);
    expect(summarizeEnrollmentStates).toHaveBeenCalledWith(expect.objectContaining({ campaignId: 'camp-1' }));
  });
});
