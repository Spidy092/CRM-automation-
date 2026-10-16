/**
 * Phase 0 reproduction — campaign operations defects.
 *
 * Each case below encodes the required behavior from
 * docs/campaign-operations-research-plan-2026-10-15.md and FAILS against the
 * pre-fix implementation. They turn green as Phase 1 lands; none of them
 * may be weakened to match legacy behavior.
 */
import { pool } from '../../shared/utils/db';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../workers/queue', () => ({
  enqueueOutreachDispatch: jest.fn(),
  enqueueOutreachFollowUp: jest.fn(),
  cancelPendingOutreachJobs: jest.fn(),
}));
jest.mock('../outreach/outreach.repository', () => ({
  findSequenceById: jest.fn(),
  findSequenceByIdIncludingDeleted: jest.fn(),
  findLogsByLead: jest.fn(),
  createLog: jest.fn(),
  updateLogStatus: jest.fn(),
}));
jest.mock('../outreach/outreach.service', () => ({
  createLog: jest.fn(),
  updateLogStatus: jest.fn(),
}));
jest.mock('../leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));
jest.mock('../templates/templates.repository', () => ({
  findTemplateById: jest.fn(),
}));
jest.mock('../integrations/integrations.repository', () => ({
  findByName: jest.fn(),
}));
jest.mock('../ai-campaign-brain/ai-campaign-brain.repository', () => ({
  findCampaignBrief: jest.fn(),
}));
jest.mock('../../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as unknown as never);
}

describe('phase 0 repro: campaign summary must count sent via events, not status', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a message that became opened still counts as sent', async () => {
    const { getCampaignStats } = await import('./campaigns.repository');
    // Two messages accepted then opened: the event-based query counts
    // sent_at (still set) independently of the advanced status.
    mockPoolQuery
      .mockResolvedValueOnce(mockQueryResult([{ total: '2' }]))
      .mockResolvedValueOnce(
        mockQueryResult([{ sent: '2', delivered: '0', opened: '2', replied: '0', failed: '0' }]),
      );
    const stats = await getCampaignStats('camp-1');
    expect(stats.sent).toBe(2);
    expect(stats.opened).toBe(2);
  });
});

describe('phase 0 repro: paused campaigns cannot send', () => {
  beforeEach(() => jest.clearAllMocks());

  it('manual retry on a paused campaign is rejected with an explanation', async () => {
    const campaignsRepo = await import('./campaigns.repository');
    const campaignsService = await import('./campaigns.service');
    const outreachRepo = await import('../outreach/outreach.repository');
    const templatesRepo = await import('../templates/templates.repository');
    jest
      .spyOn(campaignsRepo, 'findCampaignById')
      .mockResolvedValue({ id: 'camp-1', status: 'paused', sequence_id: 'seq-1' } as never);
    jest.spyOn(campaignsRepo, 'findLatestOutreachLogForLead').mockResolvedValue({
      id: 'log-1',
      step_number: 1,
      channel: 'email',
      template_id: 'tmpl-1',
      status: 'failed',
      error_message: 'boom',
    });
    jest
      .spyOn(templatesRepo, 'findTemplateById')
      .mockResolvedValue({ id: 'tmpl-1', approval_status: 'approved' } as never);
    void outreachRepo;
    await expect(
      campaignsService.retryLeadOutreachStep('camp-1', 'lead-1', {
        id: 'admin-1',
        role: 'admin',
      }),
    ).rejects.toThrow(/paused/i);
  });

  it('worker dispatch skips when the campaign is paused', async () => {
    const { handleDispatch } = await import('../../workers/outreach.worker');
    const outreachRepo = await import('../outreach/outreach.repository');
    const outreachService = await import('../outreach/outreach.service');
    const leadsRepo = await import('../leads/leads.repository');
    const campaignsRepo = await import('./campaigns.repository');

    jest.spyOn(outreachRepo, 'findSequenceByIdIncludingDeleted').mockResolvedValue({
      id: 'seq-1',
      steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: 'tmpl-1' }],
    } as never);
    jest.spyOn(outreachRepo, 'findLogsByLead').mockResolvedValue([]);
    jest
      .spyOn(leadsRepo, 'findLeadById')
      .mockResolvedValue({ id: 'lead-1', status: 'active' } as never);
    jest.spyOn(campaignsRepo, 'findCampaignById').mockResolvedValue({
      id: 'camp-1',
      status: 'paused',
      send_window_enabled: false,
      send_window_start_hour: 9,
      send_window_end_hour: 18,
      send_window_days: [1, 2, 3, 4, 5],
      send_window_timezone: 'UTC',
      daily_send_limit: null,
    } as never);
    const createLog = jest.spyOn(outreachService, 'createLog').mockResolvedValue({
      id: 'log-1',
      lead_id: 'lead-1',
      campaign_id: 'camp-1',
      channel: 'email',
      template_id: 'tmpl-1',
      step_number: 1,
      status: 'queued',
      external_msg_id: null,
      message_body: null,
      sent_at: null,
      delivered_at: null,
      opened_at: null,
      clicked_at: null,
      replied_at: null,
      click_url: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);

    await handleDispatch({
      leadId: 'lead-1',
      campaignId: 'camp-1',
      sequenceId: 'seq-1',
      stepNumber: 1,
      channel: 'email',
      templateId: 'tmpl-1',
      mockMode: true,
    });

    expect(createLog).not.toHaveBeenCalled();
  });
});
