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
  getCampaignStats: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import { AppError } from '../../shared/middleware/errorHandler';
import {
  findCampaignById,
  insertCampaign,
  updateCampaign,
  deleteCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  addLeadsToCampaign,
  removeLeadFromCampaign,
  findCampaignLeads,
  getCampaignStats,
} from './campaigns.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import {
  addLeads,
  createCampaign,
  deleteCampaignById,
  getCampaignById,
  getCampaignLeads,
  getStats,
  launchCampaignById,
  pauseCampaignById,
  removeLead,
  resumeCampaignById,
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
  created_by: 'admin-1',
  launched_at: null,
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
};

const actor = { id: 'admin-1', role: 'admin', ipAddress: '127.0.0.1' };

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(res.status).toBe('active');
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
  it('returns lead ids for a campaign', async () => {
    (findCampaignById as jest.Mock).mockResolvedValue(baseCampaign);
    (findCampaignLeads as jest.Mock).mockResolvedValue(['lead-1', 'lead-2']);
    const res = await getCampaignLeads('camp-1');
    expect(res).toEqual(['lead-1', 'lead-2']);
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
});
