import { query, queryOne } from '../../shared/utils/db';
import {
  findForms,
  countForms,
  findFormById,
  findFormBySlug,
  insertForm,
  updateForm,
  deleteForm,
  insertSubmission,
  getFormAnalytics,
} from './forms.repository';
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('../../shared/utils/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
}));

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

const BASE_FORM = {
  id: 'f1',
  name: 'Contact Us',
  slug: 'contact-us',
  description: null,
  fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
  submit_action: 'create_lead',
  submit_message: 'Thanks!',
  redirect_url: null,
  is_active: true,
  theme: {},
  email_settings: {},
  created_by: 'u1',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('findForms', () => {
  it('parses stringified fields/email_settings JSON columns', async () => {
    mockQuery.mockResolvedValueOnce([
      { ...BASE_FORM, fields: JSON.stringify(BASE_FORM.fields), email_settings: JSON.stringify({ autoReply: { enabled: true } }) },
    ]);
    const result = await findForms(20, 0);
    expect(result[0].fields).toEqual(BASE_FORM.fields);
    expect(result[0].email_settings).toEqual({ autoReply: { enabled: true } });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), [
      20,
      0,
    ]);
  });

  it('defaults fields to an empty array when JSON parsing fails', async () => {
    mockQuery.mockResolvedValueOnce([{ ...BASE_FORM, fields: 'not-json', email_settings: null }]);
    const result = await findForms(20, 0);
    expect(result[0].fields).toEqual([]);
    expect(result[0].email_settings).toEqual({});
  });

  it('defaults fields to an empty array for an unexpected type', async () => {
    mockQuery.mockResolvedValueOnce([{ ...BASE_FORM, fields: 42, email_settings: {} }]);
    const result = await findForms(20, 0);
    expect(result[0].fields).toEqual([]);
  });
});

describe('countForms', () => {
  it('parses the count as a number', async () => {
    mockQueryOne.mockResolvedValueOnce({ total: '7' });
    await expect(countForms()).resolves.toBe(7);
  });

  it('defaults to 0 when no row is returned', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(countForms()).resolves.toBe(0);
  });
});

describe('findFormById', () => {
  it('returns the mapped form when found', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...BASE_FORM, fields: BASE_FORM.fields, email_settings: {} });
    const result = await findFormById('f1');
    expect(result?.id).toBe('f1');
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(findFormById('missing')).resolves.toBeNull();
  });
});

describe('findFormBySlug', () => {
  it('queries forms by slug', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...BASE_FORM, email_settings: {} });
    const result = await findFormBySlug('contact-us');
    expect(result?.slug).toBe('contact-us');
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('WHERE slug = $1 AND deleted_at IS NULL'),
      ['contact-us'],
    );
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(findFormBySlug('missing')).resolves.toBeNull();
  });
});

describe('insertForm', () => {
  it('inserts and returns the mapped form', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...BASE_FORM, email_settings: {} });
    const result = await insertForm({
      name: 'Contact Us',
      slug: 'contact-us',
      description: null,
      fields: BASE_FORM.fields as any,
      submit_action: 'create_lead',
      submit_message: 'Thanks!',
      redirect_url: null,
      is_active: true,
      theme: {},
      created_by: 'u1',
    });
    expect(result.id).toBe('f1');
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO forms'),
      expect.arrayContaining(['Contact Us', 'contact-us']),
    );
  });

  it('throws an AppError when insert returns no row', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(
      insertForm({
        name: 'X',
        slug: 'x',
        description: null,
        fields: [],
        submit_action: 'create_lead',
        submit_message: 'Thanks!',
        redirect_url: null,
        is_active: true,
        theme: {},
        created_by: 'u1',
      }),
    ).rejects.toThrow(AppError);
  });
});

describe('updateForm', () => {
  it('builds a dynamic SET clause for the provided fields', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...BASE_FORM, name: 'New Name', email_settings: {} });
    const result = await updateForm('f1', { name: 'New Name', is_active: false });
    expect(result.name).toBe('New Name');
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SET name = $1, is_active = $2'),
      ['New Name', false, 'f1'],
    );
  });

  it('returns the existing form unchanged when no fields are given', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...BASE_FORM, email_settings: {} });
    const result = await updateForm('f1', {});
    expect(result.id).toBe('f1');
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('throws AppError(404) when no fields given and the form does not exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(updateForm('missing', {})).rejects.toThrow(AppError);
  });

  it('throws AppError(404) when the update affects no row', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(updateForm('f1', { name: 'X' })).rejects.toThrow(AppError);
  });
});

describe('deleteForm', () => {
  it('resolves when the form is soft-deleted', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'f1' });
    await expect(deleteForm('f1')).resolves.toBeUndefined();
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE forms SET deleted_at = NOW()'),
      ['f1'],
    );
  });

  it('throws AppError(404) when nothing was deleted', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(deleteForm('missing')).rejects.toThrow(AppError);
  });
});

describe('insertSubmission', () => {
  it('inserts and returns the submission row', async () => {
    const submissionRow = {
      id: 's1',
      form_id: 'f1',
      lead_id: null,
      data: { email: 'a@b.com' },
      ip_address: '1.2.3.4',
      user_agent: 'jest',
      referrer: null,
      status: 'received',
      created_at: '2026-01-01',
    };
    mockQueryOne.mockResolvedValueOnce(submissionRow);
    const result = await insertSubmission({
      form_id: 'f1',
      lead_id: null,
      data: { email: 'a@b.com' },
      ip_address: '1.2.3.4',
      user_agent: 'jest',
      referrer: null,
    });
    expect(result).toEqual(submissionRow);
  });

  it('throws an AppError when insert returns no row', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(
      insertSubmission({
        form_id: 'f1',
        lead_id: null,
        data: {},
        ip_address: null,
        user_agent: null,
        referrer: null,
      }),
    ).rejects.toThrow(AppError);
  });
});

describe('getFormAnalytics', () => {
  it('aggregates totals, submissions-by-day, and top referrers', async () => {
    mockQueryOne.mockResolvedValueOnce({ total: '10', unique_leads: '4' });
    mockQuery
      .mockResolvedValueOnce([{ date: '2026-01-01', count: '3' }])
      .mockResolvedValueOnce([{ referrer: 'Direct', count: '5' }]);

    const result = await getFormAnalytics('f1');
    expect(result).toEqual({
      totalSubmissions: 10,
      uniqueLeads: 4,
      submissionsByDay: [{ date: '2026-01-01', count: 3 }],
      topReferrers: [{ referrer: 'Direct', count: 5 }],
    });
  });

  it('defaults to zero totals when no aggregate row is returned', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result = await getFormAnalytics('f1');
    expect(result.totalSubmissions).toBe(0);
    expect(result.uniqueLeads).toBe(0);
  });
});
