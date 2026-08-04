import { LeadRow } from './leads.types';

jest.mock('../../workers/queue');
jest.mock('./leads.repository', () => ({
  findLeads: jest.fn(),
  countLeads: jest.fn(),
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
  bulkUpdateLeads: jest.fn(),
  bulkPauseLeads: jest.fn(),
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

import { enqueueScoringCalculate } from '../../workers/queue';
import {
  bulkClassifyLeads,
  bulkPauseLeads,
  bulkUpdateLeads,
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
  countLeads,
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
  bulkClassifyLeads as repoBulkClassify,
  bulkUpdateLeads as repoBulkUpdate,
  bulkPauseLeads as repoBulkPause,
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
  next_follow_up_at: null,
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

  it('includes the total row count only when asked', async () => {
    (findLeads as jest.Mock).mockResolvedValue({ rows: [baseRow], hasMore: true });
    (countLeads as jest.Mock).mockResolvedValue(212);

    const withCount = await listLeads(
      { limit: 25, countTotal: true },
      { id: 'mgr-1', role: 'manager' },
    );
    expect(withCount.meta.total).toBe(212);

    const withoutCount = await listLeads({ limit: 25 }, { id: 'mgr-1', role: 'manager' });
    expect(withoutCount.meta.total).toBeUndefined();
    expect(countLeads as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('echoes the offset and omits the cursor when offset paging', async () => {
    (findLeads as jest.Mock).mockResolvedValue({ rows: [baseRow], hasMore: true });
    const result = await listLeads({ limit: 25, offset: 25 }, { id: 'mgr-1', role: 'manager' });
    expect(result.meta.offset).toBe(25);
    expect(result.meta.nextCursor).toBeUndefined();
  });

  it('omits the cursor when a non-default sort is applied', async () => {
    (findLeads as jest.Mock).mockResolvedValue({ rows: [baseRow], hasMore: true });
    const result = await listLeads(
      { limit: 25, sortBy: 'lead_score', sortDir: 'asc' },
      { id: 'mgr-1', role: 'manager' },
    );
    expect(result.meta.nextCursor).toBeUndefined();
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

  it('pauses, records status_change activity, and audits with reason (E4)', async () => {
    (findLeadById as jest.Mock).mockResolvedValue(baseRow);
    (updateLeadStatus as jest.Mock).mockResolvedValue({ ...baseRow, status: 'paused' });
    const res = await setLeadPaused('lead-1', true, { id: 'rep-1', role: 'sales' }, 'Vacation pause');
    expect(res.status).toBe('paused');
    expect(updateLeadStatus).toHaveBeenCalledWith('lead-1', 'paused');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.paused',
        newValue: expect.objectContaining({ status: 'paused', reason: 'Vacation pause' }),
      }),
    );
  });

  it('rejects pausing a won, lost, or opted_out lead (E1 & E3)', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseRow, status: 'won' });
    await expect(
      setLeadPaused('lead-1', true, { id: 'admin-1', role: 'admin' }),
    ).rejects.toThrow('Cannot pause lead with status "won"');

    (findLeadById as jest.Mock).mockResolvedValue({ ...baseRow, status: 'opted_out' });
    await expect(
      setLeadPaused('lead-1', true, { id: 'admin-1', role: 'admin' }),
    ).rejects.toThrow('Cannot pause lead with status "opted_out"');
  });

  it('rejects resuming a non-paused lead (E2)', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ ...baseRow, status: 'won' });
    await expect(
      setLeadPaused('lead-1', false, { id: 'admin-1', role: 'admin' }),
    ).rejects.toThrow('Cannot resume lead with status "won"');
  });
});

describe('bulkClassifyLeads', () => {
  it('bulk-classifies leads, audits, and enqueues score recalculation (G3)', async () => {
    (repoBulkClassify as jest.Mock).mockResolvedValue(2);
    const actor = { id: 'admin-1', role: 'admin' as const };
    const updated = await bulkClassifyLeads(['lead-1', 'lead-2'], 'hot', actor);
    expect(updated).toBe(2);
    expect(repoBulkClassify).toHaveBeenCalledWith(['lead-1', 'lead-2'], 'hot');
    expect(enqueueScoringCalculate).toHaveBeenCalledWith('lead-1');
    expect(enqueueScoringCalculate).toHaveBeenCalledWith('lead-2');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.bulk_classified', entityId: 'bulk' }),
    );
  });
});

describe('bulkUpdateLeads', () => {
  it('updates leads in bulk and audits', async () => {
    (repoBulkUpdate as jest.Mock).mockResolvedValue(3);
    const actor = { id: 'admin-1', role: 'admin' as const };
    const count = await bulkUpdateLeads(['lead-1', 'lead-2', 'lead-3'], { notes: 'bulk updated' }, actor);
    expect(count).toBe(3);
    expect(repoBulkUpdate).toHaveBeenCalledWith(['lead-1', 'lead-2', 'lead-3'], { notes: 'bulk updated' });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.bulk_updated', entityId: 'bulk' }),
    );
  });

  it('resolves stage outcome during bulk pipeline stage update (H2)', async () => {
    (findStageById as jest.Mock).mockResolvedValue({ id: 'stage-won', pipeline_id: 'p1', is_terminal_won: true, is_terminal_lost: false });
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1', status: 'active', pipeline_stage_id: 'stage-old' });
    (findStageById as jest.Mock).mockImplementation(async (id: string) => {
      if (id === 'stage-old') return { id: 'stage-old', pipeline_id: 'p1' };
      if (id === 'stage-won') return { id: 'stage-won', pipeline_id: 'p1', is_terminal_won: true, is_terminal_lost: false };
      return null;
    });
    (repoBulkUpdate as jest.Mock).mockResolvedValue(1);

    const actor = { id: 'admin-1', role: 'admin' as const };
    const count = await bulkUpdateLeads(['lead-1'], { pipeline_stage_id: 'stage-won' }, actor);
    expect(count).toBe(1);
    expect(updateLeadOutcome).toHaveBeenCalledWith('lead-1', 'won');
  });

  it('rejects bulk move when lead belongs to a different pipeline (H3)', async () => {
    (findLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1', status: 'active', pipeline_stage_id: 'stage-p1' });
    (findStageById as jest.Mock).mockImplementation(async (id: string) => {
      if (id === 'stage-p1') return { id: 'stage-p1', pipeline_id: 'p1' };
      if (id === 'stage-p2') return { id: 'stage-p2', pipeline_id: 'p2' };
      return null;
    });

    const actor = { id: 'admin-1', role: 'admin' as const };
    await expect(
      bulkUpdateLeads(['lead-1'], { pipeline_stage_id: 'stage-p2' }, actor),
    ).rejects.toThrow('Target stage belongs to a different pipeline');
  });
});

describe('bulkPauseLeads', () => {
  it('pauses leads in bulk and audits', async () => {
    (repoBulkPause as jest.Mock).mockResolvedValue(2);
    const actor = { id: 'admin-1', role: 'admin' as const };
    const res = await bulkPauseLeads(['lead-1', 'lead-2'], true, actor);
    expect(res).toEqual({ updated: 2, cancelledJobs: 0 });
    expect(repoBulkPause).toHaveBeenCalledWith(['lead-1', 'lead-2'], 'paused');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.bulk_paused', entityId: 'bulk' }),
    );
  });
});
