jest.mock('./campaigns.repository', () => ({
  findCampaigns: jest.fn(),
  findCampaignById: jest.fn(),
  insertCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  deleteCampaign: jest.fn(),
  launchCampaign: jest.fn(),
  pauseCampaign: jest.fn(),
  resumeCampaign: jest.fn(),
  addLeadsToCampaign: jest.fn(),
  removeLeadFromCampaign: jest.fn(),
  findCampaignLeads: jest.fn(),
  findCampaignLeadsWithProgress: jest.fn(),
  findCampaignLeadRows: jest.fn(),
  findLatestOutreachLogForLead: jest.fn(),
  getCampaignStats: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../workers/queue', () => ({
  enqueueOutreachDispatch: jest.fn(),
  cancelPendingOutreachJobs: jest.fn(),
}));
jest.mock('../outreach/outreach.repository', () => ({
  findSequenceById: jest.fn(),
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
jest.mock('../../shared/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { AppError } from '../../shared/middleware/errorHandler';
import {
  findCampaigns,
  findCampaignById,
  insertCampaign,
  updateCampaign,
  deleteCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  addLeadsToCampaign,
  removeLeadFromCampaign,
  findCampaignLeadsWithProgress,
  findCampaignLeadRows,
  findLatestOutreachLogForLead,
  getCampaignStats,
} from './campaigns.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { enqueueOutreachDispatch, cancelPendingOutreachJobs } from '../../workers/queue';
import { findTemplateById } from '../templates/templates.repository';
import { findByName } from '../integrations/integrations.repository';
import { findSequenceById } from '../outreach/outreach.repository';
import { findCampaignBrief } from '../ai-campaign-brain/ai-campaign-brain.repository';
import {
  addLeads,
  createCampaign,
  deleteCampaignById,
  getAllCampaigns,
  getCampaignById,
  getCampaignAutomationPreview,
  getCampaignLeads,
  getStats,
  launchCampaignById,
  pauseCampaignById,
  removeLead,
  resumeCampaignById,
  retryLeadOutreachStep,
  updateCampaignById,
} from './campaigns.service';

const baseCampaign = {
  id: 'camp-1',
  name: 'Q3 Outreach',
  status: 'draft' as const,
  tone: 'professional' as const,
  target_industries: ['Tech'],
  target_countries: ['US'],
  sequence_id: null,
  pipeline_id: null,
  ai_personalization_enabled: false,
  autonomy_level: 'supervised' as const,
  ai_min_confidence: 0,
  created_by: 'admin-1',
  launched_at: null,
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
};

const actor = { id: 'admin-1', role: 'admin', ipAddress: '127.0.0.1' };

beforeEach(() => {
  jest.clearAllMocks();
  (findCampaignLeadRows as jest.Mock).mockResolvedValue([]);
  (findTemplateById as jest.Mock).mockResolvedValue({
    id: 'tmpl-1',
    channel: 'email',
    approval_status: 'approved',
  });
  (findByName as jest.Mock).mockResolvedValue({
    name: 'sendgrid',
    is_enabled: true,
    last_test_status: 'ok',
  });
  (findCampaignBrief as jest.Mock).mockResolvedValue(null);
});

describe('getCampaignById', () => {
  it('returns a campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    await expect(getCampaignById('camp-1')).resolves.toBe(baseCampaign);
  });

  it('throws 404 when missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(getCampaignById('x')).rejects.toBeInstanceOf(AppError);
  });
});

describe('getAllCampaigns', () => {
  it('delegates to findCampaigns', async () => {
    (findCampaigns as jest.Mock).mockResolvedValue([baseCampaign]);
    await expect(getAllCampaigns()).resolves.toEqual([baseCampaign]);
    expect(findCampaigns).toHaveBeenCalled();
  });

  it('returns empty array when none exist', async () => {
    (findCampaigns as jest.Mock).mockResolvedValue([]);
    await expect(getAllCampaigns()).resolves.toEqual([]);
  });
});

describe('createCampaign', () => {
  it('inserts and audits', async () => {
    (insertCampaign as jest.Mock).mockResolvedValue(baseCampaign);
    const res = await createCampaign(
      { name: 'Q3 Outreach', tone: 'professional', target_industries: ['Tech'], target_countries: ['US'] },
      actor,
    );
    expect(res.id).toBe('camp-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('updateCampaignById', () => {
  it('refuses to edit an active campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });
    await expect(updateCampaignById('camp-1', { name: 'x' }, actor)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('updates and audits when not active', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (updateCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, name: 'Q4' });
    const res = await updateCampaignById('camp-1', { name: 'Q4' }, actor);
    expect(res.name).toBe('Q4');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('deleteCampaignById', () => {
  it('refuses to delete an active campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });
    await expect(deleteCampaignById('camp-1', actor)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('deletes and audits when draft', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    await deleteCampaignById('camp-1', actor);
    expect(deleteCampaign).toHaveBeenCalledWith('camp-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('launch / pause / resume', () => {
  it('launches from draft', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active', launched_at: '2026-06-19T01:00:00Z' });
    const res = await launchCampaignById('camp-1', actor);
    expect(res.campaign.status).toBe('active');
    expect(res.automation).toEqual({ enqueued: 0, skipped: 0, mockMode: false });
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('refuses to launch an already-active campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });
    await expect(launchCampaignById('camp-1', actor)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('pauses an active campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });
    (pauseCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'paused' });
    const res = await pauseCampaignById('camp-1', actor);
    expect(res.status).toBe('paused');
  });

  it('refuses to pause a non-active campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    await expect(pauseCampaignById('camp-1', actor)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('resumes a paused campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'paused' });
    (resumeCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });
    const res = await resumeCampaignById('camp-1', actor);
    expect(res.status).toBe('active');
  });

  it('refuses to resume a non-paused campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    await expect(resumeCampaignById('camp-1', actor)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('addLeads / removeLead', () => {
  it('adds leads and audits', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (addLeadsToCampaign as jest.Mock).mockResolvedValue([{ id: 'cl-1' }, { id: 'cl-2' }]);
    const res = await addLeads('camp-1', ['lead-1', 'lead-2'], actor);
    expect(res.added).toBe(2);
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('throws 404 when adding to missing campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(addLeads('x', ['lead-1'], actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('removes lead and audits', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    await removeLead('camp-1', 'lead-1', actor);
    expect(removeLeadFromCampaign).toHaveBeenCalledWith('camp-1', 'lead-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('getCampaignLeads / getStats', () => {
  it('returns lead rows for a campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (findCampaignLeadsWithProgress as jest.Mock).mockResolvedValue([
      { lead_id: 'lead-1', progress: 0 },
      { lead_id: 'lead-2', progress: 50 },
    ]);
    const res = await getCampaignLeads('camp-1');
    expect(res).toEqual([
      { lead_id: 'lead-1', progress: 0 },
      { lead_id: 'lead-2', progress: 50 },
    ]);
  });

  it('throws 404 when campaign missing for getCampaignLeads', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(getCampaignLeads('x')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns stats', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (getCampaignStats as jest.Mock).mockResolvedValue({
      total_leads: 5,
      sent: 1,
      delivered: 0,
      opened: 0,
      replied: 0,
      failed: 0,
    });
    const res = await getStats('camp-1');
    expect(res.total_leads).toBe(5);
  });

  it('throws 404 when campaign missing for getStats', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(getStats('x')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('removeLead 404 branch', () => {
  it('throws 404 when campaign missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(removeLead('x', 'lead-1', actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(removeLeadFromCampaign).not.toHaveBeenCalled();
  });
});

describe('updateCampaignById 404 branch', () => {
  it('throws 404 when campaign missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(updateCampaignById('x', { name: 'x' }, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(updateCampaign).not.toHaveBeenCalled();
  });
});

describe('deleteCampaignById 404 branch', () => {
  it('throws 404 when campaign missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(deleteCampaignById('x', actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(deleteCampaign).not.toHaveBeenCalled();
  });
});

describe('launch / pause / resume — additional status variants', () => {
  it('launches from paused status', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'paused' });
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });
    const res = await launchCampaignById('camp-1', actor);
    expect(res.campaign.status).toBe('active');
  });

  it('refuses to launch from completed status', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'completed' });
    await expect(launchCampaignById('camp-1', actor)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('launch throws 404 when campaign missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(launchCampaignById('x', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('pause throws 404 when campaign missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(pauseCampaignById('x', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('resume throws 404 when campaign missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(resumeCampaignById('x', actor)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('retryLeadOutreachStep', () => {
  const activeCampaign = { ...baseCampaign, status: 'active' as const, sequence_id: 'seq-1' };
  const failedLog = {
    id: 'log-1',
    step_number: 2,
    channel: 'email' as const,
    template_id: 'tmpl-1',
    status: 'failed',
    error_message: 'SendGrid credentials not set',
  };

  it('re-enqueues the latest failed step', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(activeCampaign);
    (findLatestOutreachLogForLead as jest.Mock).mockResolvedValue(failedLog);

    const result = await retryLeadOutreachStep('camp-1', 'lead-1', actor);

    expect(result).toEqual({ enqueued: true });
    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      {
        leadId: 'lead-1',
        campaignId: 'camp-1',
        sequenceId: 'seq-1',
        stepNumber: 2,
        channel: 'email',
        templateId: 'tmpl-1',
        mockMode: false,
        aiPersonalizationEnabled: false,
      },
      { jobIdSuffix: expect.stringMatching(/^retry-\d+$/) },
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.outreach.retried' }),
    );
  });

  it('throws 404 when campaign missing', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(null);
    await expect(retryLeadOutreachStep('camp-1', 'lead-1', actor)).rejects.toBeInstanceOf(AppError);
  });

  it('refuses when campaign has no sequence', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, sequence_id: null });
    await expect(retryLeadOutreachStep('camp-1', 'lead-1', actor)).rejects.toThrow(
      'Campaign has no outreach sequence',
    );
  });

  it('refuses when campaign is draft', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...activeCampaign, status: 'draft' });
    await expect(retryLeadOutreachStep('camp-1', 'lead-1', actor)).rejects.toThrow(
      'Campaign must be active or paused',
    );
  });

  it('refuses when there is no failed log for the lead', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(activeCampaign);
    (findLatestOutreachLogForLead as jest.Mock).mockResolvedValue(null);
    await expect(retryLeadOutreachStep('camp-1', 'lead-1', actor)).rejects.toThrow(
      'No failed send found for this lead',
    );
  });

  it('refuses when the latest log is not failed', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(activeCampaign);
    (findLatestOutreachLogForLead as jest.Mock).mockResolvedValue({ ...failedLog, status: 'sent' });
    await expect(retryLeadOutreachStep('camp-1', 'lead-1', actor)).rejects.toThrow(
      'No failed send found for this lead',
    );
  });

  it('refuses when the template is no longer approved', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(activeCampaign);
    (findLatestOutreachLogForLead as jest.Mock).mockResolvedValue(failedLog);
    (findTemplateById as jest.Mock).mockResolvedValue({
      id: 'tmpl-1',
      channel: 'email',
      approval_status: 'pending',
    });
    await expect(retryLeadOutreachStep('camp-1', 'lead-1', actor)).rejects.toThrow(
      'Template is no longer approved',
    );
  });
});

describe('launchCampaignById — outreach enqueueing', () => {
  it('launches and enqueues for leads with sequence', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'draft', sequence_id: 'seq-1' });
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active', sequence_id: 'seq-1', launched_at: '2026-06-19T01:00:00Z' });
    (findCampaignLeadRows as jest.Mock).mockResolvedValue([
      { id: 'lead-1', business_name: 'Lead 1', email: 'one@example.com', phone: '+1', status: 'active' },
      { id: 'lead-2', business_name: 'Lead 2', email: 'two@example.com', phone: '+2', status: 'active' },
    ]);
    (findSequenceById as jest.Mock).mockResolvedValue({
      id: 'seq-1',
      steps: [{ stepNumber: 1, channel: 'email', templateId: 't1', delayHours: 0 }],
    });

    const res = await launchCampaignById('camp-1', actor);
    expect(res.campaign.status).toBe('active');
    expect(enqueueOutreachDispatch).toHaveBeenCalledTimes(2);
    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      campaignId: 'camp-1',
      sequenceId: 'seq-1',
      stepNumber: 1,
      channel: 'email',
      templateId: 't1',
      mockMode: false,
    }));
    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-2',
      campaignId: 'camp-1',
      sequenceId: 'seq-1',
      stepNumber: 1,
      channel: 'email',
      templateId: 't1',
      mockMode: false,
    }));
  });

  it('launches without sequence — skips enqueue', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });

    const res = await launchCampaignById('camp-1', actor);
    expect(res.campaign.status).toBe('active');
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('launches with sequence but no leads — skips enqueue', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'draft', sequence_id: 'seq-1' });
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active', sequence_id: 'seq-1' });
    (findCampaignLeadRows as jest.Mock).mockResolvedValue([]);
    (findSequenceById as jest.Mock).mockResolvedValue({
      id: 'seq-1',
      steps: [{ stepNumber: 1, channel: 'email', templateId: 't1', delayHours: 0 }],
    });

    const res = await launchCampaignById('camp-1', actor);
    expect(res.campaign.status).toBe('active');
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('launches with sequence but sequence has no steps — skips enqueue', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'draft', sequence_id: 'seq-1' });
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active', sequence_id: 'seq-1' });
    (findSequenceById as jest.Mock).mockResolvedValue({ id: 'seq-1', steps: [] });

    const res = await launchCampaignById('camp-1', actor);
    expect(res.campaign.status).toBe('active');
    expect(enqueueOutreachDispatch).not.toHaveBeenCalled();
  });

  it('launches and gracefully handles enqueue errors', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'draft', sequence_id: 'seq-1' });
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active', sequence_id: 'seq-1', launched_at: '2026-06-19T01:00:00Z' });
    (findCampaignLeadRows as jest.Mock).mockResolvedValue([
      { id: 'lead-1', business_name: 'Lead 1', email: 'one@example.com', phone: '+1', status: 'active' },
      { id: 'lead-2', business_name: 'Lead 2', email: 'two@example.com', phone: '+2', status: 'active' },
    ]);
    (findSequenceById as jest.Mock).mockResolvedValue({
      id: 'seq-1',
      steps: [{ stepNumber: 1, channel: 'email', templateId: 't1', delayHours: 0 }],
    });

    (enqueueOutreachDispatch as jest.Mock)
      .mockRejectedValueOnce(new Error('Queue error'))
      .mockResolvedValueOnce(undefined);

    const res = await launchCampaignById('camp-1', actor);
    expect(res.campaign.status).toBe('active');
    expect(enqueueOutreachDispatch).toHaveBeenCalledTimes(2);
  });
});

describe('getCampaignAutomationPreview — full-sequence validation', () => {
  const twoStepSequence = {
    id: 'seq-1',
    steps: [
      { stepNumber: 1, channel: 'email', templateId: 't1', delayHours: 0 },
      { stepNumber: 2, channel: 'sms', templateId: 't2', delayHours: 24 },
    ],
  };

  beforeEach(() => {
    (findCampaignById as jest.Mock).mockResolvedValue({ ...baseCampaign, sequence_id: 'seq-1' });
    (findSequenceById as jest.Mock).mockResolvedValue(twoStepSequence);
  });

  it('flags an unapproved template on a later step', async () => {
    (findTemplateById as jest.Mock).mockImplementation(async (id: string) =>
      id === 't1'
        ? { id: 't1', name: 'Intro Email', channel: 'email', approval_status: 'approved' }
        : { id: 't2', name: 'SMS Nudge', channel: 'sms', approval_status: 'pending' },
    );
    (findByName as jest.Mock).mockResolvedValue({ is_enabled: true, last_test_status: 'ok' });

    const preview = await getCampaignAutomationPreview('camp-1');
    expect(preview.templateIssues).toEqual(['Step 2: template "SMS Nudge" is not approved.']);
  });

  it('flags a channel mismatch on a later step', async () => {
    (findTemplateById as jest.Mock).mockImplementation(async (id: string) =>
      id === 't1'
        ? { id: 't1', name: 'Intro Email', channel: 'email', approval_status: 'approved' }
        : { id: 't2', name: 'Wrong Channel', channel: 'email', approval_status: 'approved' },
    );
    (findByName as jest.Mock).mockResolvedValue({ is_enabled: true, last_test_status: 'ok' });

    const preview = await getCampaignAutomationPreview('camp-1');
    expect(preview.templateIssues).toEqual([
      'Step 2: template channel (email) does not match the sequence step (sms).',
    ]);
  });

  it('flags a missing template on a later step', async () => {
    (findTemplateById as jest.Mock).mockImplementation(async (id: string) =>
      id === 't1'
        ? { id: 't1', name: 'Intro Email', channel: 'email', approval_status: 'approved' }
        : null,
    );
    (findByName as jest.Mock).mockResolvedValue({ is_enabled: true, last_test_status: 'ok' });

    const preview = await getCampaignAutomationPreview('camp-1');
    expect(preview.templateIssues).toEqual(['Step 2: template was not found.']);
  });

  it('flags a missing connector for a later-step channel', async () => {
    (findTemplateById as jest.Mock).mockImplementation(async (id: string) =>
      id === 't1'
        ? { id: 't1', name: 'Intro Email', channel: 'email', approval_status: 'approved' }
        : { id: 't2', name: 'SMS Nudge', channel: 'sms', approval_status: 'approved' },
    );
    (findByName as jest.Mock).mockImplementation(async (name: string) =>
      name === 'twilio' ? null : { is_enabled: true, last_test_status: 'ok' },
    );

    const preview = await getCampaignAutomationPreview('camp-1');
    expect(preview.templateIssues).toEqual([]);
    expect(preview.connectorIssues).toEqual(['No ready connector configured for sms.']);
  });

  it('reports no issues when every step is approved and connected', async () => {
    (findTemplateById as jest.Mock).mockImplementation(async (id: string) =>
      id === 't1'
        ? { id: 't1', name: 'Intro Email', channel: 'email', approval_status: 'approved' }
        : { id: 't2', name: 'SMS Nudge', channel: 'sms', approval_status: 'approved' },
    );
    (findByName as jest.Mock).mockResolvedValue({ is_enabled: true, last_test_status: 'ok' });

    const preview = await getCampaignAutomationPreview('camp-1');
    expect(preview.templateIssues).toEqual([]);
    expect(preview.connectorIssues).toEqual([]);
    expect(preview.firstStep).toEqual({ stepNumber: 1, channel: 'email', templateId: 't1', delayHours: 0 });
  });
});

describe('launchCampaignById — AI brief approval requirement', () => {
  const guardedCampaign = {
    ...baseCampaign,
    autonomy_level: 'guarded' as const,
    ai_min_confidence: 70,
    ai_personalization_enabled: true,
  };

  const approvedBrief = {
    id: 'brief-1',
    campaign_id: 'camp-1',
    status: 'approved',
    approved_by: 'manager-1',
    approved_at: '2026-06-19T00:00:00.000Z',
  };

  it('succeeds when an approved AI brief exists', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(guardedCampaign);
    (findCampaignBrief as jest.Mock).mockResolvedValue(approvedBrief);
    (launchCampaign as jest.Mock).mockResolvedValue({ ...guardedCampaign, status: 'active' });

    const res = await launchCampaignById('camp-1', actor);

    expect(res.campaign.status).toBe('active');
    expect(findCampaignBrief).toHaveBeenCalledWith('camp-1');
  });

  it('succeeds under override when autonomy is supervised and ai_min_confidence is 0 without a brief', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (launchCampaign as jest.Mock).mockResolvedValue({ ...baseCampaign, status: 'active' });

    const res = await launchCampaignById('camp-1', actor);

    expect(res.campaign.status).toBe('active');
    expect(findCampaignBrief).not.toHaveBeenCalled();
  });

  it('fails when no approved brief exists and override does not apply', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(guardedCampaign);
    (findCampaignBrief as jest.Mock).mockResolvedValue(null);

    await expect(launchCampaignById('camp-1', actor)).rejects.toMatchObject({
      statusCode: 400,
      message: 'AI brief approval required before launch',
    });
    expect(launchCampaign).not.toHaveBeenCalled();
  });

  it('fails when a non-approved brief exists and override does not apply', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(guardedCampaign);
    (findCampaignBrief as jest.Mock).mockResolvedValue({
      ...approvedBrief,
      status: 'draft',
      approved_by: null,
      approved_at: null,
    });

    await expect(launchCampaignById('camp-1', actor)).rejects.toMatchObject({
      statusCode: 400,
      message: 'AI brief approval required before launch',
    });
    expect(launchCampaign).not.toHaveBeenCalled();
  });
});
