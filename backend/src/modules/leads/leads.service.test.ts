import { LeadRow } from './leads.types';

jest.mock('../../workers/queue');
jest.mock('./leads.repository', () => ({
  findLeads: jest.fn(),
  findLeadById: jest.fn(),
  findExistingForDedup: jest.fn(),
  findLeadsByScraperLogId: jest.fn(),
  findLeadsByIds: jest.fn(),
  insertLead: jest.fn(),
  updateLead: jest.fn(),
  updateLeadOutcome: jest.fn(),
  softDeleteLead: jest.fn(),
  updateLeadStatus: jest.fn(),
  runInTransaction: jest.fn(),
  findActivityForLead: jest.fn(),
  bulkClassifyLeads: jest.fn(),
}));
jest.mock('../pipeline/pipeline.repository', () => ({
  findStageById: jest.fn(),
}));
jest.mock('../activities/activities.repository', () => ({
  createOutboundActivityAndUpdateLead: jest.fn(),
  insertActivity: jest.fn(),
}));
jest.mock('../custom-fields/customFields.repository', () => ({
  findActiveDefinitions: jest.fn(),
}));
jest.mock('../custom-fields/customFields.service', () => ({
  validateCustomFieldValues: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import {
  createLead,
  getLeadById,
  getLeadsByScraperLogId,
  getLeadsByIds,
  listLeads,
  logOutboundActivity,
  setLeadPaused,
  softDeleteLeadById,
  updateLeadFields,
} from './leads.service';
import {
  createOutboundActivityAndUpdateLead,
  insertActivity,
} from '../activities/activities.repository';
import {
  findExistingForDedup,
  findLeadById,
  findLeads,
  findLeadsByScraperLogId,
  findLeadsByIds,
  insertLead,
  softDeleteLead,
  updateLead,
  updateLeadOutcome,
  updateLeadStatus,
} from './leads.repository';
import { findStageById } from '../pipeline/pipeline.repository';
import { validateCustomFieldValues } from '../custom-fields/customFields.service';
import { writeAuditLog } from '../../shared/utils/audit';

const baseRow: LeadRow = {
  id: 'lead-1',
  business_name: 'Acme',
  contact_name: 'John',
  phone: '+1234567890',
  email: 'john@acme.com',
  website: null,
  industry: 'Tech',
  location: 'NYC',
  country: 'US',
  google_rating: '4.5',
  review_count: 10,
  social_links: null,
  source_platform: 'manual_upload',
  lead_score: 0,
  classification: null,
  status: 'active',
  assigned_to: 'rep-1',
  pipeline_stage_id: null,
  custom_fields: {},
  tags: [],
  notes: null,
  deal_value: null,
  won_at: null,
  lost_at: null,
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
  deleted_at: null,
  scraper_log_id: null,
};

const validInput = {
  business_name: 'Acme',
  contact_name: 'John',
  phone: '+1 234 567 8901',
  email: 'John@Acme.com',
  industry: 'Tech',
  location: 'NYC',
  source_platform: 'manual_upload',
};

const mockActivity = {
  id: 'act-1',
  lead_id: 'lead-1',
  user_id: 'user-1',
  type: 'call',
  metadata: {},
  created_at: '2026-06-19T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  (validateCustomFieldValues as jest.Mock).mockReturnValue({
    valid: true,
    sanitized: {},
    errors: [],
  });
});

describe('logOutboundActivity', () => {
  it('delegates to createOutboundActivityAndUpdateLead', async () => {
    (createOutboundActivityAndUpdateLead as jest.Mock).mockResolvedValue(mockActivity);
    const res = await logOutboundActivity('lead-1', 'user-1', 'email', { subject: 'Hi' });
    expect(res).toEqual(mockActivity);
    expect(createOutboundActivityAndUpdateLead).toHaveBeenCalledWith({
      lead_id: 'lead-1',
      user_id: 'user-1',
      type: 'email',
      metadata: { subject: 'Hi' },
    });
  });

  it('supports call and whatsapp types', async () => {
    (createOutboundActivityAndUpdateLead as jest.Mock).mockResolvedValue({ ...mockActivity, type: 'whatsapp' });
    const res = await logOutboundActivity('lead-2', 'user-2', 'whatsapp');
    expect(res.type).toBe('whatsapp');
    expect(createOutboundActivityAndUpdateLead).toHaveBeenCalledWith({
      lead_id: 'lead-2',
      user_id: 'user-2',
      type: 'whatsapp',
      metadata: undefined,
    });
  });
});

describe('createLead', () => {
  it('throws 409 on duplicate', async () => {
    (findExistingForDedup as jest.Mock).mockResolvedValue(baseRow);
    await expect(createLead(validInput, { id: 'admin-1', role: 'admin' })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(insertLead).not.toHaveBeenCalled();
  });

  it('throws 422 on invalid custom fields', async () => {
    (findExistingForDedup as jest.Mock).mockResolvedValue(null);
    (validateCustomFieldValues as jest.Mock).mockReturnValue({
      valid: false,
      sanitized: {},
      errors: ['bad'],
    });
    await expect(createLead(validInput, { id: 'admin-1', role: 'admin' })).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('creates, normalizes identifiers, and audits on success', async () => {
    (findExistingForDedup as jest.Mock).mockResolvedValue(null);
    (insertLead as jest.Mock).mockResolvedValue(baseRow);
    const res = await createLead(validInput, { id: 'admin-1', role: 'admin' });
    expect(res.id).toBe('lead-1');
    expect(res.google_rating).toBe(4.5);
    // insertLead should have been called with normalized email/phone
    const passed = (insertLead as jest.Mock).mock.calls[0][0];
    expect(passed.email).toBe('john@acme.com');
    expect(passed.phone).toBe('+12345678901');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('getLeadById', () => {
  it('throws 404 when not found', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(null);
    await expect(getLeadById('x', { id: 'admin-1', role: 'admin' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('allows a sales rep to read their own lead', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    const res = await getLeadById('lead-1', { id: 'rep-1', role: 'sales' });
    expect(res.id).toBe('lead-1');
  });

  it('forbids a sales rep from reading another rep lead', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    await expect(getLeadById('lead-1', { id: 'rep-2', role: 'sales' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('allows a manager to read any lead', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    const res = await getLeadById('lead-1', { id: 'mgr-1', role: 'manager' });
    expect(res.id).toBe('lead-1');
  });
});

describe('getLeadsByScraperLogId', () => {
  it('maps leads created by the given scraper run', async () => {
    (findLeadsByScraperLogId as jest.Mock).mockResolvedValue([baseRow]);
    const result = await getLeadsByScraperLogId('log-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('lead-1');
    expect(findLeadsByScraperLogId).toHaveBeenCalledWith('log-1');
  });

  it('returns an empty array when the run created no leads', async () => {
    (findLeadsByScraperLogId as jest.Mock).mockResolvedValue([]);
    expect(await getLeadsByScraperLogId('log-2')).toEqual([]);
  });
});

describe('getLeadsByIds', () => {
  it('maps leads matching the given IDs', async () => {
    (findLeadsByIds as jest.Mock).mockResolvedValue([baseRow]);
    const result = await getLeadsByIds(['lead-1']);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('lead-1');
    expect(findLeadsByIds).toHaveBeenCalledWith(['lead-1']);
  });

  it('returns an empty array when given no IDs', async () => {
    (findLeadsByIds as jest.Mock).mockResolvedValue([]);
    expect(await getLeadsByIds([])).toEqual([]);
  });
});

describe('listLeads', () => {
  it('scopes sales reps to their own leads', async () => {
    (findLeads as jest.Mock).mockResolvedValue({ rows: [], hasMore: false });
    await listLeads({ limit: 25 }, { id: 'rep-1', role: 'sales' });
    const filters = (findLeads as jest.Mock).mock.calls[0][0];
    expect(filters.assigned_to).toBe('rep-1');
  });

  it('does not scope managers', async () => {
    (findLeads as jest.Mock).mockResolvedValue({ rows: [], hasMore: false });
    await listLeads({ limit: 25 }, { id: 'mgr-1', role: 'manager' });
    const filters = (findLeads as jest.Mock).mock.calls[0][0];
    expect(filters.assigned_to).toBeUndefined();
  });

  it('returns a nextCursor when there are more rows', async () => {
    (findLeads as jest.Mock).mockResolvedValue({ rows: [baseRow], hasMore: true });
    const result = await listLeads({ limit: 25 }, { id: 'mgr-1', role: 'manager' });
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.nextCursor).toBeDefined();
  });
});

describe('updateLeadFields', () => {
  it('throws 404 when not found', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(null);
    await expect(
      updateLeadFields('x', { notes: 'hi' }, { id: 'admin-1', role: 'admin' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('forbids a sales rep from updating a lead they do not own', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    await expect(
      updateLeadFields('lead-1', { notes: 'hi' }, { id: 'rep-2', role: 'sales' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('updates and audits on success', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    (updateLead as jest.Mock).mockResolvedValue({ ...baseRow, notes: 'hi' });
    const res = await updateLeadFields(
      'lead-1',
      { notes: 'hi' },
      { id: 'rep-1', role: 'sales' },
    );
    expect(res.notes).toBe('hi');
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('logs status_change activity when pipeline_stage_id changes', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseRow, pipeline_stage_id: 'stage-1' });
    (updateLead as jest.Mock).mockResolvedValue({ ...baseRow, pipeline_stage_id: 'stage-2' });
    await updateLeadFields(
      'lead-1',
      { pipeline_stage_id: 'stage-2' },
      { id: 'admin-1', role: 'admin' },
    );
    expect(insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-1',
        user_id: 'admin-1',
        type: 'status_change',
        metadata: expect.objectContaining({
          field: 'pipeline_stage_id',
          from: 'stage-1',
          to: 'stage-2',
        }),
      }),
    );
  });

  it('logs assignment_change activity when assigned_to changes', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseRow, assigned_to: 'rep-1' });
    (updateLead as jest.Mock).mockResolvedValue({ ...baseRow, assigned_to: 'rep-2' });
    await updateLeadFields(
      'lead-1',
      { assigned_to: 'rep-2' },
      { id: 'admin-1', role: 'admin' },
    );
    expect(insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: 'lead-1',
        user_id: 'admin-1',
        type: 'assignment_change',
        metadata: expect.objectContaining({
          from: 'rep-1',
          to: 'rep-2',
        }),
      }),
    );
  });

  it('does not log activity when pipeline_stage_id or assigned_to are unchanged', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseRow, pipeline_stage_id: 'stage-1' });
    (updateLead as jest.Mock).mockResolvedValue({ ...baseRow, pipeline_stage_id: 'stage-1' });
    await updateLeadFields(
      'lead-1',
      { pipeline_stage_id: 'stage-1' },
      { id: 'admin-1', role: 'admin' },
    );
    expect(insertActivity).not.toHaveBeenCalled();
  });

  it('auto-marks the lead won when moved into a terminal-won stage', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({
      ...baseRow,
      pipeline_stage_id: 'stage-1',
      status: 'active',
    });
    (updateLead as jest.Mock).mockResolvedValue({ ...baseRow, pipeline_stage_id: 'stage-2' });
    (findStageById as jest.Mock).mockResolvedValue({ is_terminal_won: true, is_terminal_lost: false });
    (updateLeadOutcome as jest.Mock).mockResolvedValue({
      ...baseRow,
      pipeline_stage_id: 'stage-2',
      status: 'won',
      won_at: '2026-07-20T00:00:00.000Z',
    });

    const res = await updateLeadFields(
      'lead-1',
      { pipeline_stage_id: 'stage-2' },
      { id: 'admin-1', role: 'admin' },
    );

    expect(updateLeadOutcome).toHaveBeenCalledWith('lead-1', 'won');
    expect(res.status).toBe('won');
    expect(res.won_at).toBe('2026-07-20T00:00:00.000Z');
    expect(insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status_change',
        metadata: expect.objectContaining({ field: 'status', from: 'active', to: 'won' }),
      }),
    );
  });

  it('reopens a won lead moved to a non-terminal stage', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({
      ...baseRow,
      pipeline_stage_id: 'stage-2',
      status: 'won',
    });
    (updateLead as jest.Mock).mockResolvedValue({ ...baseRow, pipeline_stage_id: 'stage-1' });
    (findStageById as jest.Mock).mockResolvedValue({ is_terminal_won: false, is_terminal_lost: false });
    (updateLeadOutcome as jest.Mock).mockResolvedValue({
      ...baseRow,
      pipeline_stage_id: 'stage-1',
      status: 'active',
    });

    const res = await updateLeadFields(
      'lead-1',
      { pipeline_stage_id: 'stage-1' },
      { id: 'admin-1', role: 'admin' },
    );

    expect(updateLeadOutcome).toHaveBeenCalledWith('lead-1', 'active');
    expect(res.status).toBe('active');
  });

  it('does not call findStageById or updateLeadOutcome when stage is unset (null)', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({
      ...baseRow,
      pipeline_stage_id: 'stage-1',
      status: 'active',
    });
    (updateLead as jest.Mock).mockResolvedValue({ ...baseRow, pipeline_stage_id: null });

    await updateLeadFields('lead-1', { pipeline_stage_id: null }, { id: 'admin-1', role: 'admin' });

    expect(findStageById).not.toHaveBeenCalled();
    expect(updateLeadOutcome).not.toHaveBeenCalled();
  });
});

describe('softDeleteLeadById', () => {
  it('throws 404 when not found', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(null);
    await expect(softDeleteLeadById('x', { id: 'admin-1', role: 'admin' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('soft-deletes and audits', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    (softDeleteLead as jest.Mock).mockResolvedValue(undefined);
    await softDeleteLeadById('lead-1', { id: 'admin-1', role: 'admin' });
    expect(softDeleteLead).toHaveBeenCalledWith('lead-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('setLeadPaused', () => {
  it('is idempotent when already in the target status', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow); // status active
    const res = await setLeadPaused('lead-1', false, { id: 'rep-1', role: 'sales' });
    expect(res.status).toBe('active');
    expect(updateLeadStatus).not.toHaveBeenCalled();
  });

  it('pauses and audits', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    (updateLeadStatus as jest.Mock).mockResolvedValue({ ...baseRow, status: 'paused' });
    const res = await setLeadPaused('lead-1', true, { id: 'rep-1', role: 'sales' });
    expect(res.status).toBe('paused');
    expect(updateLeadStatus).toHaveBeenCalledWith('lead-1', 'paused');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});
