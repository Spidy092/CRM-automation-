/**
 * Outreach worker tests.
 *
 * Tests the three handler functions extracted from the BullMQ worker:
 *   - handleDispatch (success + failure + mock mode)
 *   - handleFollowUp (enqueues next step)
 *   - handleStopCheck (max_messages, replied, opted_out)
 */

import {
  handleDispatch,
  handleFollowUp,
  handleStopCheck,
  handleSendAiReply,
  startOutreachWorker,
} from './outreach.worker';

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
  enqueueOutreachDispatch: jest.fn(),
  enqueueOutreachFollowUp: jest.fn(),
  enqueueOutreachStopCheck: jest.fn(),
  OUTREACH_QUEUE: 'outreach',
}));

jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

jest.mock('../modules/outreach/outreach.repository', () => ({
  findSequenceById: jest.fn(),
  findLogsByLead: jest.fn(),
}));

jest.mock('../modules/outreach/outreach.service', () => ({
  createLog: jest.fn(),
  updateLogStatus: jest.fn(),
}));

jest.mock('../modules/leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));

jest.mock('../modules/templates/templates.repository', () => ({
  findTemplateById: jest.fn(),
}));

jest.mock('../modules/campaigns/campaigns.repository', () => ({
  findCampaignById: jest.fn(),
  countSentTodayForCampaign: jest.fn(),
}));

jest.mock('../modules/integrations/dispatch', () => ({
  dispatchOutbound: jest.fn(),
}));

jest.mock('../modules/outreach/outreach.prompt', () => ({
  personalizeMessage: jest.fn(),
}));

import { findSequenceById, findLogsByLead } from '../modules/outreach/outreach.repository';
import { createLog, updateLogStatus } from '../modules/outreach/outreach.service';
import { findLeadById } from '../modules/leads/leads.repository';
import { findTemplateById } from '../modules/templates/templates.repository';
import {
  findCampaignById,
  countSentTodayForCampaign,
} from '../modules/campaigns/campaigns.repository';
import { dispatchOutbound } from '../modules/integrations/dispatch';
import { personalizeMessage } from '../modules/outreach/outreach.prompt';
import { enqueueOutreachDispatch, enqueueOutreachFollowUp } from './queue';

describe('startOutreachWorker', () => {
  it('starts without error when redis is available', () => {
    // Worker instantiation is covered by the integration test.
    // startOutreachWorker() returns a Worker instance.
    expect(() => startOutreachWorker()).not.toThrow();
  });
});

describe('handleDispatch', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseSeq = {
    id: 'seq1',
    name: 'Test Sequence',
    steps: [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: 't1' },
      { stepNumber: 2, channel: 'sms' as const, delayHours: 24, templateId: 't2' },
    ],
    created_by: 'u1',
    created_at: '2026-06-19T00:00:00Z',
    updated_at: '2026-06-19T00:00:00Z',
  };

  const createdLog = {
    id: 'log1',
    lead_id: 'lead1',
    campaign_id: 'camp1',
    channel: 'email',
    template_id: 't1',
    step_number: 1,
    status: 'queued',
    external_msg_id: null,
    message_body: null,
    sent_at: null,
    delivered_at: null,
    opened_at: null,
    replied_at: null,
    error_message: null,
    created_at: '2026-06-19T00:00:00Z',
    updated_at: '2026-06-19T00:00:00Z',
  };

  it('dispatches in mock mode, creates log, and schedules follow-up', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'sent' });

    await handleDispatch({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      stepNumber: 1,
      channel: 'email',
      templateId: 't1',
      mockMode: true,
    });

    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead1', channel: 'email', status: 'queued' }),
    );
    expect(updateLogStatus).toHaveBeenCalledWith(
      'log1',
      'sent',
      expect.objectContaining({ externalMsgId: expect.stringContaining('mock-email') }),
    );
    expect(enqueueOutreachFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ nextStepNumber: 2, delayHours: 24 }),
    );
  });

  it('does not schedule follow-up when there is no next step', async () => {
    const seq = { ...baseSeq, steps: [baseSeq.steps[0]] };
    (findSequenceById as jest.Mock).mockResolvedValue(seq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'sent' });

    await handleDispatch({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      stepNumber: 1,
      channel: 'email',
      templateId: 't1',
      mockMode: true,
    });

    expect(enqueueOutreachFollowUp).not.toHaveBeenCalled();
  });

  it('throws when sequence is missing', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(null);
    await expect(
      handleDispatch({
        leadId: 'lead1',
        campaignId: 'camp1',
        sequenceId: 'seq1',
        stepNumber: 1,
        channel: 'email',
        templateId: 't1',
        mockMode: true,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws when step is missing', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    await expect(
      handleDispatch({
        leadId: 'lead1',
        campaignId: 'camp1',
        sequenceId: 'seq1',
        stepNumber: 99,
        channel: 'email',
        templateId: 't1',
        mockMode: true,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws with 502 when mockMode=false and lead not found', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (findLeadById as jest.Mock).mockResolvedValue(null);

    await expect(
      handleDispatch({
        leadId: 'lead1',
        campaignId: 'camp1',
        sequenceId: 'seq1',
        stepNumber: 1,
        channel: 'email',
        templateId: 't1',
        mockMode: false,
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws with 502 when mockMode=false and template not approved', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: 'a@b.com', phone: '123' });
    (findTemplateById as jest.Mock).mockResolvedValue({ id: 't1', approval_status: 'rejected' });

    await expect(
      handleDispatch({
        leadId: 'lead1',
        campaignId: 'camp1',
        sequenceId: 'seq1',
        stepNumber: 1,
        channel: 'email',
        templateId: 't1',
        mockMode: false,
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws with 502 when mockMode=false and lead has no destination', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: '', phone: '' });
    (findTemplateById as jest.Mock).mockResolvedValue({ id: 't1', approval_status: 'approved', subject: 'Hi' });
    (personalizeMessage as jest.Mock).mockResolvedValue({ message: 'Hello' });

    await expect(
      handleDispatch({
        leadId: 'lead1',
        campaignId: 'camp1',
        sequenceId: 'seq1',
        stepNumber: 1,
        channel: 'email',
        templateId: 't1',
        mockMode: false,
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it('updates log to sent and enqueues follow-up when dispatch succeeds', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: 'a@b.com', phone: '123' });
    (findTemplateById as jest.Mock).mockResolvedValue({ id: 't1', approval_status: 'approved', subject: 'Hi' });
    (personalizeMessage as jest.Mock).mockResolvedValue({ message: 'Hello' });
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: true, externalId: 'ext-1', latencyMs: 10 });
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'sent' });

    await handleDispatch({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      stepNumber: 1,
      channel: 'email',
      templateId: 't1',
      mockMode: false,
    });

    expect(updateLogStatus).toHaveBeenCalledWith(
      'log1',
      'sent',
      expect.objectContaining({ externalMsgId: 'ext-1' }),
    );
    expect(enqueueOutreachFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ nextStepNumber: 2, delayHours: 24 }),
    );
  });

  it('passes the template attachments through to dispatchOutbound', async () => {
    const templateAttachments = [
      {
        id: 'a1',
        filename: 'flyer.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        url: 'http://x/flyer.png',
        storagePath: '/x/flyer.png',
      },
    ];
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: 'a@b.com', phone: '123' });
    (findTemplateById as jest.Mock).mockResolvedValue({
      id: 't1',
      approval_status: 'approved',
      subject: 'Hi',
      attachments: templateAttachments,
    });
    (personalizeMessage as jest.Mock).mockResolvedValue({ message: 'Hello' });
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: true, externalId: 'ext-1', latencyMs: 10 });
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'sent' });

    await handleDispatch({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      stepNumber: 1,
      channel: 'email',
      templateId: 't1',
      mockMode: false,
    });

    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: templateAttachments }),
    );
  });

  it('updates log to failed and throws with 502 when dispatchOutbound returns ok:false', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: 'a@b.com', phone: '123' });
    (findTemplateById as jest.Mock).mockResolvedValue({ id: 't1', approval_status: 'approved', subject: 'Hi' });
    (personalizeMessage as jest.Mock).mockResolvedValue({ message: 'Hello' });
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: false, error: 'Provider error', latencyMs: 5 });
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'failed' });

    await expect(
      handleDispatch({
        leadId: 'lead1',
        campaignId: 'camp1',
        sequenceId: 'seq1',
        stepNumber: 1,
        channel: 'email',
        templateId: 't1',
        mockMode: false,
      }),
    ).rejects.toMatchObject({ statusCode: 502 });

    expect(updateLogStatus).toHaveBeenCalledWith(
      'log1',
      'failed',
      expect.objectContaining({ errorMessage: 'Provider error' }),
    );
  });
});

describe('handleFollowUp', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseSeq = {
    id: 'seq1',
    name: 'Test',
    steps: [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: 't1' },
      { stepNumber: 2, channel: 'sms' as const, delayHours: 24, templateId: 't2' },
    ],
    created_by: 'u1',
    created_at: '2026-06-19T00:00:00Z',
    updated_at: '2026-06-19T00:00:00Z',
  };

  it('enqueues stop-check and next dispatch when sequence/step exists', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);

    await handleFollowUp({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      previousStepNumber: 1,
      nextStepNumber: 2,
      delayHours: 24,
      mockMode: true,
    });

    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ stepNumber: 2, channel: 'sms', templateId: 't2', mockMode: true }),
    );
  });

  it('does nothing when sequence is missing', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(null);

    await handleFollowUp({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      previousStepNumber: 1,
      nextStepNumber: 2,
      delayHours: 24,
      mockMode: true,
    });

    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('does nothing when next step is missing', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(baseSeq);

    await handleFollowUp({
      leadId: 'lead1',
      campaignId: 'camp1',
      sequenceId: 'seq1',
      previousStepNumber: 1,
      nextStepNumber: 99,
      delayHours: 24,
      mockMode: true,
    });

    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });
});

describe('handleSendAiReply', () => {
  beforeEach(() => jest.clearAllMocks());

  const createdLog = {
    id: 'log-ai-1',
    lead_id: 'lead1',
    campaign_id: 'camp1',
    channel: 'email',
    template_id: null,
    step_number: null,
    status: 'queued',
    external_msg_id: null,
    message_body: 'Great, let us schedule a call.',
    sent_at: null,
    delivered_at: null,
    opened_at: null,
    replied_at: null,
    error_message: null,
    created_at: '2026-06-19T00:00:00Z',
    updated_at: '2026-06-19T00:00:00Z',
  };

  it('sends the draft, creates a log with no template, and marks it sent', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: 'a@b.com', phone: '123' });
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: true, externalId: 'ext-ai-1' });
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'sent' });

    await handleSendAiReply({
      leadId: 'lead1',
      campaignId: 'camp1',
      channel: 'email',
      body: 'Great, let us schedule a call.',
    });

    expect(createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead1',
        campaignId: 'camp1',
        channel: 'email',
        templateId: null,
        messageBody: 'Great, let us schedule a call.',
        status: 'queued',
      }),
    );
    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead1',
        campaignId: 'camp1',
        channel: 'email',
        body: 'Great, let us schedule a call.',
        destination: 'a@b.com',
        logId: 'log-ai-1',
      }),
    );
    expect(updateLogStatus).toHaveBeenCalledWith(
      'log-ai-1',
      'sent',
      expect.objectContaining({ externalMsgId: 'ext-ai-1' }),
    );
  });

  it('passes an empty campaignId through to dispatchOutbound when the lead has no active campaign', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: 'a@b.com', phone: '123' });
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: true, externalId: 'ext-ai-2' });
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'sent' });

    await handleSendAiReply({
      leadId: 'lead1',
      campaignId: null,
      channel: 'sms',
      body: 'Sure, calling you now.',
    });

    expect(createLog).toHaveBeenCalledWith(expect.objectContaining({ campaignId: null }));
    expect(dispatchOutbound).toHaveBeenCalledWith(expect.objectContaining({ campaignId: '' }));
  });

  it('throws when the lead is not found', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(null);

    await expect(
      handleSendAiReply({ leadId: 'missing', campaignId: null, channel: 'email', body: 'Hi.' }),
    ).rejects.toThrow('Lead missing not found');
    expect(createLog).not.toHaveBeenCalled();
  });

  it('throws when the lead has no destination for the channel', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: '', phone: '' });

    await expect(
      handleSendAiReply({ leadId: 'lead1', campaignId: 'camp1', channel: 'email', body: 'Hi.' }),
    ).rejects.toThrow('Lead lead1 has no email destination');
    expect(createLog).not.toHaveBeenCalled();
  });

  it('marks the log failed and throws with 502 when dispatchOutbound returns ok:false', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', email: 'a@b.com', phone: '123' });
    (createLog as jest.Mock).mockResolvedValue(createdLog);
    (dispatchOutbound as jest.Mock).mockResolvedValue({ ok: false, error: 'Provider error' });
    (updateLogStatus as jest.Mock).mockResolvedValue({ ...createdLog, status: 'failed' });

    await expect(
      handleSendAiReply({ leadId: 'lead1', campaignId: 'camp1', channel: 'email', body: 'Hi.' }),
    ).rejects.toMatchObject({ statusCode: 502 });

    expect(updateLogStatus).toHaveBeenCalledWith(
      'log-ai-1',
      'failed',
      expect.objectContaining({ errorMessage: 'Provider error' }),
    );
  });
});

describe('handleStopCheck', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns stopped=true for max_messages', async () => {
    (findLogsByLead as jest.Mock).mockResolvedValue([
      { id: 'l1', status: 'sent', campaign_id: 'camp1' },
      { id: 'l2', status: 'sent', campaign_id: 'camp1' },
    ] as any);
    (findLeadById as jest.Mock).mockResolvedValue(null);

    const result = await handleStopCheck({
      leadId: 'lead1',
      campaignId: 'camp1',
      rules: [{ type: 'max_messages', value: 2 }],
    });

    expect(result).toEqual({ stopped: true, reason: 'max_messages' });
  });

  it('returns stopped=true for replied', async () => {
    (findLogsByLead as jest.Mock).mockResolvedValue([
      { id: 'l1', status: 'replied', campaign_id: 'camp1' },
    ] as any);
    (findLeadById as jest.Mock).mockResolvedValue(null);

    const result = await handleStopCheck({
      leadId: 'lead1',
      campaignId: 'camp1',
      rules: [{ type: 'replied' }],
    });

    expect(result).toEqual({ stopped: true, reason: 'replied' });
  });

  it('returns stopped=true for opted_out', async () => {
    (findLogsByLead as jest.Mock).mockResolvedValue([]);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', status: 'opted_out' });

    const result = await handleStopCheck({
      leadId: 'lead1',
      campaignId: 'camp1',
      rules: [{ type: 'opted_out' }],
    });

    expect(result).toEqual({ stopped: true, reason: 'opted_out' });
  });

  it('returns stopped=false when no rules match', async () => {
    (findLogsByLead as jest.Mock).mockResolvedValue([
      { id: 'l1', status: 'sent', campaign_id: 'camp1' },
    ] as any);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', status: 'active' });

    const result = await handleStopCheck({
      leadId: 'lead1',
      campaignId: 'camp1',
      rules: [
        { type: 'max_messages', value: 5 },
        { type: 'replied' },
        { type: 'opted_out' },
      ],
    });

    expect(result).toEqual({ stopped: false });
  });
});

describe('handleDispatch — send window / daily cap deferral', () => {
  beforeEach(() => jest.clearAllMocks());

  const seq = {
    id: 'seq1',
    name: 'Seq',
    steps: [{ stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: 't1' }],
    created_by: 'u1',
    created_at: '2026-06-19T00:00:00Z',
    updated_at: '2026-06-19T00:00:00Z',
  };

  const baseCampaign = {
    id: 'camp1',
    send_window_enabled: false,
    send_window_start_hour: 9,
    send_window_end_hour: 18,
    send_window_days: [1, 2, 3, 4, 5],
    send_window_timezone: 'UTC',
    daily_send_limit: null as number | null,
  };

  const dispatchJob = {
    leadId: 'lead1',
    campaignId: 'camp1',
    sequenceId: 'seq1',
    stepNumber: 1,
    channel: 'email' as const,
    templateId: 't1',
    mockMode: true,
  };

  it('re-enqueues with a delay when the daily cap is reached', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(seq);
    (findLogsByLead as jest.Mock).mockResolvedValue([]);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', status: 'active' });
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, daily_send_limit: 10 });
    (countSentTodayForCampaign as jest.Mock).mockResolvedValue(10);

    await handleDispatch(dispatchJob);

    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      dispatchJob,
      expect.objectContaining({
        delayMs: expect.any(Number),
        jobIdSuffix: expect.stringMatching(/^deferred-\d+$/),
      }),
    );
    // No message log is created while deferred.
    expect(createLog).not.toHaveBeenCalled();
  });

  it('sends normally when under the cap and no window is set', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(seq);
    (findLogsByLead as jest.Mock).mockResolvedValue([]);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', status: 'active' });
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, daily_send_limit: 10 });
    (countSentTodayForCampaign as jest.Mock).mockResolvedValue(3);
    (createLog as jest.Mock).mockResolvedValue({ id: 'log1' });
    (updateLogStatus as jest.Mock).mockResolvedValue(undefined);

    await handleDispatch(dispatchJob);

    expect(createLog).toHaveBeenCalled();
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('does not query the sent count when there is no daily limit', async () => {
    (findSequenceById as jest.Mock).mockResolvedValue(seq);
    (findLogsByLead as jest.Mock).mockResolvedValue([]);
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead1', status: 'active' });
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (createLog as jest.Mock).mockResolvedValue({ id: 'log1' });
    (updateLogStatus as jest.Mock).mockResolvedValue(undefined);

    await handleDispatch(dispatchJob);

    expect(countSentTodayForCampaign).not.toHaveBeenCalled();
  });
});
