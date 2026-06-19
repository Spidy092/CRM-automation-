import { LeadRow } from './leads.types';

jest.mock('./leads.repository', () => ({
  findLeads: jest.fn(),
  findLeadById: jest.fn(),
  findExistingForDedup: jest.fn(),
  insertLead: jest.fn(),
  updateLead: jest.fn(),
  softDeleteLead: jest.fn(),
  updateLeadStatus: jest.fn(),
  runInTransaction: jest.fn(),
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
  listLeads,
  setLeadPaused,
  softDeleteLeadById,
  updateLeadFields,
} from './leads.service';
import {
  findExistingForDedup,
  findLeadById,
  findLeads,
  insertLead,
  softDeleteLead,
  updateLead,
  updateLeadStatus,
} from './leads.repository';
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
  created_at: '2026-06-19T00:00:00.000Z',
  updated_at: '2026-06-19T00:00:00.000Z',
  deleted_at: null,
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

beforeEach(() => {
  jest.clearAllMocks();
  (validateCustomFieldValues as jest.Mock).mockReturnValue({
    valid: true,
    sanitized: {},
    errors: [],
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
